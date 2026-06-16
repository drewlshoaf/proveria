// /tenants/:slug/projects + /tenants/:slug/projects/:projectSlug
//
// Lists, creates, and shows projects scoped to a tenant. The database still
// stores a template slug for compatibility, but V5 project creation no longer
// exposes template choice to users.
//
// Visibility defaults per plan: Free → public, paid tiers → private. Producers
// and Tenant Admins can create projects; anyone in the tenant can read.

import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import {
  PROJECT_TEMPLATE_SLUGS,
  isProjectTemplateSlug,
} from '@proveria/shared-types';
import {
  projects,
  tenantMemberships,
  type DrizzleClient,
  type Project,
  type ProjectVisibility,
  type User,
} from '@proveria/db';

import { writeAuditEvent } from '../audit/writer.js';
import { requireDeviceSignatureFactory } from '../auth/device-signature.js';
import { requireSessionFactory } from '../auth/session-hook.js';
import { checkProjectCountLimit } from '../entitlements/limits.js';
import { resolveTenantContext } from '../tenants/resolver.js';

export interface ProjectPluginOptions {
  db: DrizzleClient;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DEFAULT_PROJECT_TEMPLATE_SLUG = 'general_provenance';

const defaultVisibilityFor = (plan: string): ProjectVisibility =>
  plan === 'free' ? 'public' : 'private';

const publicProject = (
  p: Project,
): {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  classification: string | null;
  tags: unknown;
  visibility: ProjectVisibility;
  createdByUserId: string;
  createdAt: string;
  archivedAt: string | null;
} => {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    classification: p.classification,
    tags: p.tags,
    visibility: p.visibility,
    createdByUserId: p.createdByUserId,
    createdAt: p.createdAt.toISOString(),
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
  };
};

export const projectPlugin: FastifyPluginAsync<ProjectPluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;
  const requireSession = requireSessionFactory(db);
  const requireDeviceSignature = requireDeviceSignatureFactory(db);

  const requireSessionOrDevice: import('fastify').preHandlerAsyncHookHandler =
    async (req, reply) => {
      if (typeof req.headers['x-proveria-device-id'] === 'string') {
        await requireDeviceSignature.call(app, req, reply);
        return;
      }
      await requireSession.call(app, req, reply);
    };

  const resolveProjectContext = async (
    req: import('fastify').FastifyRequest,
    slug: string,
  ) => {
    if (req.currentDevice) {
      const tenant = req.currentDeviceTenant!;
      if (tenant.slug !== slug) return null;
      const [membership] = await db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, tenant.id),
            eq(tenantMemberships.userId, req.currentDeviceUser!.id),
          ),
        )
        .limit(1);
      if (!membership) return null;
      return { tenant, membership, user: req.currentDeviceUser! };
    }
    const user = req.currentUser as User;
    const ctx = await resolveTenantContext(db, user, slug);
    return ctx ? { ...ctx, user } : null;
  };

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/projects  (any member)
  //
  // Archived projects are hidden by default. A tenant admin may pass
  // ?includeArchived=true to see them too (docs/v1 §10.1 — archived projects
  // remain visible to admins).
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string };
    Querystring: { includeArchived?: string };
  }>(
    '/tenants/:slug/projects',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveProjectContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });

      const includeArchived =
        req.query.includeArchived === 'true' &&
        ctx.membership.role === 'tenant_admin';

      const rows = await db
        .select()
        .from(projects)
        .where(
          includeArchived
            ? eq(projects.tenantId, ctx.tenant.id)
            : and(
                eq(projects.tenantId, ctx.tenant.id),
                isNull(projects.archivedAt),
              ),
        );
      return { projects: rows.map(publicProject) };
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/projects  (tenant_admin or producer)
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/tenants/:slug/projects',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          required: ['slug', 'name'],
          additionalProperties: false,
          properties: {
            slug: { type: 'string', minLength: 1, maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            templateSlug: {
              type: 'string',
              enum: PROJECT_TEMPLATE_SLUGS as unknown as string[],
            },
            classification: { type: 'string', maxLength: 100 },
            tags: { type: 'array', items: { type: 'string', maxLength: 64 } },
            visibility: { type: 'string', enum: ['public', 'private'] },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await resolveProjectContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (
        ctx.membership.role !== 'tenant_admin' &&
        ctx.membership.role !== 'producer'
      ) {
        throw app.httpErrors.forbidden();
      }

      const body = req.body as {
        slug: string;
        name: string;
        description?: string;
        templateSlug?: string;
        classification?: string;
        tags?: string[];
        visibility?: ProjectVisibility;
      };

      if (!SLUG_RE.test(body.slug)) {
        return reply.code(400).send({ error: 'invalid_slug' });
      }
      if (body.templateSlug && !isProjectTemplateSlug(body.templateSlug)) {
        return reply.code(400).send({ error: 'invalid_template' });
      }
      const templateSlug = body.templateSlug ?? DEFAULT_PROJECT_TEMPLATE_SLUG;

      // Free tier projects are public-only; paid tiers default to private.
      const requestedVisibility =
        body.visibility ?? defaultVisibilityFor(ctx.tenant.plan);
      if (ctx.tenant.plan === 'free' && requestedVisibility === 'private') {
        return reply
          .code(400)
          .send({ error: 'private_projects_require_paid_plan' });
      }

      const existing = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.tenantId, ctx.tenant.id),
            eq(projects.slug, body.slug),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return reply.code(409).send({ error: 'slug_taken' });
      }

      // Plan cap (docs/v1 §22.2). Free is 5; paid tiers are uncapped.
      const projectCap = await checkProjectCountLimit(
        db,
        ctx.tenant.id,
        ctx.tenant.plan,
      );
      if (!projectCap.ok) {
        return reply.code(409).send({
          error: projectCap.error,
          limit: projectCap.limit,
          current: projectCap.current,
        });
      }

      const inserted = await db
        .insert(projects)
        .values({
          tenantId: ctx.tenant.id,
          slug: body.slug,
          name: body.name,
          description: body.description ?? null,
          templateSlug,
          classification: body.classification ?? null,
          tags: body.tags ?? [],
          visibility: requestedVisibility,
          createdByUserId: ctx.user.id,
        })
        .returning();
      const project = inserted[0];
      if (!project) throw new Error('failed to insert project');

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        category: AUDIT_CATEGORIES.project,
        action: AUDIT_ACTIONS.projectCreated,
        targetType: 'project',
        targetId: project.id,
        payload: {
          slug: project.slug,
          visibility: project.visibility,
        },
      });

      reply.code(201).send({ project: publicProject(project) });
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/projects/:projectSlug  (any member)
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string; projectSlug: string } }>(
    '/tenants/:slug/projects/:projectSlug',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveProjectContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });

      const rows = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.tenantId, ctx.tenant.id),
            eq(projects.slug, req.params.projectSlug),
          ),
        )
        .limit(1);
      const project = rows[0];
      if (!project) return reply.code(404).send({ error: 'not_found' });

      return { project: publicProject(project) };
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/projects/:projectSlug/archive   (tenant_admin only)
  // POST /tenants/:slug/projects/:projectSlug/restore   (tenant_admin only)
  //
  // Archive/restore is a Tenant Admin capability (docs/v1 §8.5). Archived
  // projects cannot receive new attestations but stay visible + verifiable.
  // There is no hard delete in V1.
  // -----------------------------------------------------------------------
  for (const action of ['archive', 'restore'] as const) {
    app.post<{ Params: { slug: string; projectSlug: string } }>(
      `/tenants/:slug/projects/:projectSlug/${action}`,
      { preHandler: requireSessionOrDevice },
      async (req, reply) => {
        const ctx = await resolveProjectContext(req, req.params.slug);
        if (!ctx) return reply.code(404).send({ error: 'not_found' });
        if (ctx.membership.role !== 'tenant_admin') {
          throw app.httpErrors.forbidden();
        }

        const rows = await db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.tenantId, ctx.tenant.id),
              eq(projects.slug, req.params.projectSlug),
            ),
          )
          .limit(1);
        const project = rows[0];
        if (!project) return reply.code(404).send({ error: 'not_found' });

        const alreadyArchived = project.archivedAt !== null;
        if (action === 'archive' && alreadyArchived) {
          return reply.code(409).send({ error: 'already_archived' });
        }
        if (action === 'restore' && !alreadyArchived) {
          return reply.code(409).send({ error: 'not_archived' });
        }

        const [updated] = await db
          .update(projects)
          .set({ archivedAt: action === 'archive' ? new Date() : null })
          .where(eq(projects.id, project.id))
          .returning();
        if (!updated) throw new Error('failed to update project');

        await writeAuditEvent(db, {
          tenantId: ctx.tenant.id,
          actorUserId: ctx.user.id,
          actorDeviceId: req.currentDevice?.id,
          category: AUDIT_CATEGORIES.project,
          action:
            action === 'archive'
              ? AUDIT_ACTIONS.projectArchived
              : AUDIT_ACTIONS.projectRestored,
          targetType: 'project',
          targetId: project.id,
          payload: { slug: project.slug },
        });

        return { project: publicProject(updated) };
      },
    );
  }
};
