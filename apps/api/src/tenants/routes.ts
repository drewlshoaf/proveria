// /tenants/* and /invitations/* routes.
// Tenant-scoped routes resolve { tenant, membership } from the :slug path
// segment; missing tenant OR missing membership both 404 (no enumeration).
// Tenant Admin gates use ensureRole, which throws 403 via @fastify/sensible.

import {
  and,
  asc,
  count as drizzleCount,
  desc,
  eq,
  gte,
  gt,
  inArray,
  isNull,
  lte,
} from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import { computeChainHash } from '@proveria/audit';
import { computeMerkleRoot } from '@proveria/crypto-core';
import {
  attestations,
  auditCheckpoints,
  auditEventHashChain,
  auditEvents,
  exportJobs,
  organizationMemberships,
  organizations,
  projects,
  submissionAttempts,
  tenantInvitations,
  tenantMemberships,
  tenants,
  users,
  verificationLinks,
  verificationResults,
  type DrizzleClient,
  type ExportJob,
  type OrganizationRole,
  type Role,
  type Tenant,
  type User,
  type WorkspaceAccessMode,
} from '@proveria/db';

import { writeAuditEvent } from '../audit/writer.js';
import { requireDeviceSignatureFactory } from '../auth/device-signature.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { requireSessionFactory } from '../auth/session-hook.js';
import { randomSlugSuffix } from '../auth/slug.js';
import { cleanupExpiredEvidenceExports } from '../evidence-export/cleanup.js';
import {
  checkUserCountLimit,
  limitsFor,
} from '../entitlements/limits.js';
import type { NotificationProvider } from '../notifications/provider.js';
import { deleteObject, getObjectBytes } from '../objects/client.js';
import { enqueueEvidenceExport } from '../queues/producer.js';
import { resolveTenantContext, type TenantContext } from './resolver.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface TenantPluginOptions {
  db: DrizzleClient;
  notifications: NotificationProvider;
  getObjectBytes?: (key: string) => Promise<Buffer | null>;
  deleteObject?: (key: string) => Promise<void>;
  enqueueEvidenceExport?: (job: {
    jobId: string;
    requestId?: string;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const emailLooksValid = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const minutesFromNow = (minutes: number): Date =>
  new Date(Date.now() + minutes * 60 * 1000);

const daysFromNow = (days: number): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const INVITATION_TTL_MINUTES = 60 * 24 * 7; // 7 days
const EXPORT_JOB_RETENTION_DAYS = 30;
const EXPORT_JOB_MAX_RETRIES = 3;

const ROLE_VALUES: readonly Role[] = ['tenant_admin', 'producer', 'consumer'];
const ORGANIZATION_ROLE_VALUES: readonly OrganizationRole[] = [
  'organization_admin',
  'member',
];
const WORKSPACE_ACCESS_MODE_VALUES: readonly WorkspaceAccessMode[] = [
  'all_workspaces',
  'selected_workspaces',
  'none',
];
const PROJECT_NOUN_OPTIONS = [
  'Project',
  'Team',
  'Case',
  'Client',
  'Department',
  'Matter',
  'Engagement',
] as const;

const SLUG_RE = /[^a-z0-9]+/g;

const baseSlugFromName = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length === 0) return 'workspace';
  return base.slice(0, 40);
};

const ensureRole = (
  app: import('fastify').FastifyInstance,
  ctx: TenantContext,
  allowed: readonly Role[],
): void => {
  if (!allowed.includes(ctx.membership.role)) {
    throw app.httpErrors.forbidden();
  }
};

const publicTenant = (
  t: Tenant,
): {
  id: string;
  slug: string;
  name: string;
  plan: string;
  projectNoun: string;
  isPersonal: boolean;
  archivedAt: string | null;
} => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  plan: t.plan,
  projectNoun: t.projectNoun ?? 'Project',
  isPersonal: t.isPersonal,
  archivedAt: t.archivedAt?.toISOString() ?? null,
});

type ExportJobPublicFields = Pick<
  ExportJob,
  | 'id'
  | 'kind'
  | 'status'
  | 'filters'
  | 'artifactCount'
  | 'rowCount'
  | 'resultObjectKey'
  | 'error'
  | 'progressPercent'
  | 'retryCount'
  | 'maxRetries'
  | 'expiresAt'
  | 'retentionPolicy'
  | 'createdAt'
  | 'startedAt'
  | 'completedAt'
>;

const publicExportJob = (job: ExportJobPublicFields) => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  filters: job.filters,
  artifactCount: job.artifactCount,
  rowCount: job.rowCount,
  resultObjectKey: job.resultObjectKey,
  error: job.error,
  progressPercent: job.progressPercent,
  retryCount: job.retryCount,
  maxRetries: job.maxRetries,
  expiresAt: job.expiresAt?.toISOString() ?? null,
  retentionPolicy: job.retentionPolicy,
  createdAt: job.createdAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  completedAt: job.completedAt?.toISOString() ?? null,
});

type EvidenceExportScope = 'workspace' | 'organization';
type RequestTenantContext = TenantContext & { user: User };

interface EvidenceExportTargets {
  scope: EvidenceExportScope;
  tenantIds: string[];
  organization: { id: string; name: string } | null;
  workspaces: Array<{ id: string; slug: string; name: string }>;
}

const parseEvidenceExportScope = (value: unknown): EvidenceExportScope => {
  if (value === 'organization') return 'organization';
  return 'workspace';
};

const resolveEvidenceExportTargets = async (
  app: import('fastify').FastifyInstance,
  db: DrizzleClient,
  ctx: RequestTenantContext,
  scope: EvidenceExportScope,
): Promise<EvidenceExportTargets> => {
  if (scope === 'workspace') {
    return {
      scope,
      tenantIds: [ctx.tenant.id],
      organization: null,
      workspaces: [
        { id: ctx.tenant.id, slug: ctx.tenant.slug, name: ctx.tenant.name },
      ],
    };
  }

  if (!ctx.tenant.organizationId) {
    throw app.httpErrors.forbidden();
  }
  const [membership] = await db
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, ctx.tenant.organizationId),
        eq(organizationMemberships.userId, ctx.user.id),
      ),
    )
    .limit(1);
  if (
    !membership ||
    membership.revokedAt ||
    membership.orgRole !== 'organization_admin'
  ) {
    throw app.httpErrors.forbidden();
  }

  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ctx.tenant.organizationId))
    .limit(1);
  const workspaceRows = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(
      and(
        eq(tenants.organizationId, ctx.tenant.organizationId),
        isNull(tenants.archivedAt),
      ),
    )
    .orderBy(asc(tenants.name));

  return {
    scope,
    tenantIds: workspaceRows.map((workspace) => workspace.id),
    organization: organization ?? null,
    workspaces: workspaceRows,
  };
};

const uniqueWorkspaceSlug = async (
  db: Pick<DrizzleClient, 'select'>,
  name: string,
): Promise<string> => {
  const base = baseSlugFromName(name);
  let slug = base;
  for (let i = 0; i < 8; i += 1) {
    const taken = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (!taken[0]) return slug;
    slug = `${base}-${randomSlugSuffix()}`;
  }
  return `${base}-${randomSlugSuffix()}`;
};

const countActiveAdmins = async (
  db: DrizzleClient,
  tenantId: string,
): Promise<number> => {
  const rows = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.role, 'tenant_admin'),
      ),
    );
  return rows.length;
};

const countActiveOrganizationAdmins = async (
  db: DrizzleClient,
  organizationId: string,
): Promise<number> => {
  const rows = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.orgRole, 'organization_admin'),
        isNull(organizationMemberships.revokedAt),
      ),
    );
  return rows.length;
};

// Audit visibility by role + plan (docs/v1 §8.5, §19.3). Consumers see no
// tenant audit. Producers get a "limited" view — the workflow categories.
// Tenant admins see everything on paid plans; on Free the audit posture is
// minimal (§19.3 Free column), so admins see only the registry-history and
// attestation-lifecycle categories.
const WORKFLOW_CATEGORIES: readonly string[] = [
  AUDIT_CATEGORIES.project,
  AUDIT_CATEGORIES.attestationLifecycle,
  AUDIT_CATEGORIES.validation,
  AUDIT_CATEGORIES.proofResultPackage,
  AUDIT_CATEGORIES.verificationLookup,
];
const FREE_ADMIN_CATEGORIES: readonly string[] = [
  AUDIT_CATEGORIES.minimalRegistryHistory,
  AUDIT_CATEGORIES.attestationLifecycle,
];

/** null categories = unrestricted; 'denied' = no audit access at all. */
const auditVisibility = (
  role: Role,
  plan: string,
): { categories: readonly string[] | null } | 'denied' => {
  if (role === 'consumer') return 'denied';
  if (role === 'producer') return { categories: WORKFLOW_CATEGORIES };
  // tenant_admin
  if (plan === 'free') return { categories: FREE_ADMIN_CATEGORIES };
  return { categories: null };
};

const csvCell = (value: unknown): string => {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const parseExportDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

type AuditExportRow = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  category: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  actorUserId: string | null;
  actorDeviceId: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

type AuditExportFilters = {
  actorUserId: string | null;
  category: string | null;
  projectId: string | null;
  workspaceId?: string | null;
  from: string | null;
  to: string | null;
};

const auditExportCsv = (
  rows: AuditExportRow[],
  includeWorkspace: boolean,
): string => {
  const header = [
    ...(includeWorkspace ? ['workspaceId', 'workspaceSlug', 'workspaceName'] : []),
    'id',
    'createdAt',
    'category',
    'action',
    'actorUserId',
    'actorEmail',
    'actorDeviceId',
    'targetType',
    'targetId',
    'payload',
  ].join(',');
  const body = rows
    .map((r) =>
      [
        ...(includeWorkspace ? [r.tenantId, r.tenantSlug, r.tenantName] : []),
        r.id,
        r.createdAt.toISOString(),
        r.category,
        r.action,
        r.actorUserId,
        r.actorEmail,
        r.actorDeviceId,
        r.targetType,
        r.targetId,
        r.payload,
      ]
        .map(csvCell)
        .join(','),
    )
    .join('\n');
  return `${header}\n${body}${body ? '\n' : ''}`;
};

const auditExportEvents = (
  rows: AuditExportRow[],
  includeWorkspace: boolean,
) =>
  rows.map((r) => ({
    ...(includeWorkspace
      ? {
          workspace: {
            id: r.tenantId,
            slug: r.tenantSlug,
            name: r.tenantName,
          },
        }
      : {}),
    id: r.id,
    category: r.category,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    payload: r.payload,
    actorUserId: r.actorUserId,
    actorDeviceId: r.actorDeviceId,
    actorEmail: r.actorEmail,
    createdAt: r.createdAt.toISOString(),
  }));

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const tenantPlugin: FastifyPluginAsync<TenantPluginOptions> = async (
  app,
  opts,
) => {
  const { db, notifications } = opts;
  const readObjectBytes = opts.getObjectBytes ?? getObjectBytes;
  const removeObject = opts.deleteObject ?? deleteObject;
  const enqueueExport = opts.enqueueEvidenceExport ?? enqueueEvidenceExport;
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

  const resolveRequestTenantContext = async (
    req: import('fastify').FastifyRequest,
    slug: string,
  ): Promise<(TenantContext & { user: User }) | null> => {
    if (req.currentDevice) {
      const tenant = req.currentDeviceTenant!;
      if (tenant.slug !== slug) return null;
      const ctx = await resolveTenantContext(db, req.currentDeviceUser!, slug);
      return ctx ? { ...ctx, user: req.currentDeviceUser! } : null;
    }
    const user = req.currentUser as User;
    const ctx = await resolveTenantContext(db, user, slug);
    return ctx ? { ...ctx, user } : null;
  };

  // -----------------------------------------------------------------------
  // POST /tenants
  //
  // Explicit workspace creation for self-registered desktop users. Registering
  // creates the account; this route creates the first tenant only when the
  // user names the workspace.
  // -----------------------------------------------------------------------
  app.post(
    '/tenants',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const { name } = req.body as { name: string };
      const trimmedName = name.trim();
      if (!trimmedName) return reply.code(400).send({ error: 'invalid_name' });

      const existingMemberships = await db
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.userId, user.id));
      if (existingMemberships.length > 0) {
        return reply.code(409).send({ error: 'workspace_already_exists' });
      }

      const tenant = await db.transaction(async (tx) => {
        const slug = await uniqueWorkspaceSlug(tx, trimmedName);

        const [organizationRow] = await tx
          .insert(organizations)
          .values({
            name: trimmedName,
          })
          .returning();
        if (!organizationRow) throw new Error('failed to insert organization');

        const [tenantRow] = await tx
          .insert(tenants)
          .values({
            organizationId: organizationRow.id,
            name: trimmedName,
            slug,
            plan: 'free',
            isPersonal: false,
          })
          .returning();
        if (!tenantRow) throw new Error('failed to insert tenant');

        await tx.insert(tenantMemberships).values({
          tenantId: tenantRow.id,
          userId: user.id,
          role: 'tenant_admin',
        });
        await tx.insert(organizationMemberships).values({
          organizationId: organizationRow.id,
          userId: user.id,
          orgRole: 'organization_admin',
          workspaceAccessMode: 'selected_workspaces',
        });

        return tenantRow;
      });

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.tenantCreated,
        targetType: 'tenant',
        targetId: tenant.id,
      });
      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.tenantMemberAdded,
        targetType: 'user',
        targetId: user.id,
        payload: { role: 'tenant_admin' },
      });

      reply.code(201).send({
        tenant: {
          ...publicTenant(tenant),
          role: 'tenant_admin',
          organizationId: tenant.organizationId,
        },
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/workspaces  (org admin only)
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/tenants/:slug/workspaces',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (!ctx.tenant.organizationId) {
        return reply.code(409).send({ error: 'organization_required' });
      }
      const organizationId = ctx.tenant.organizationId;
      const [orgMembership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(
              organizationMemberships.organizationId,
              organizationId,
            ),
            eq(organizationMemberships.userId, ctx.user.id),
            isNull(organizationMemberships.revokedAt),
          ),
        )
        .limit(1);
      if (orgMembership?.orgRole !== 'organization_admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { name } = req.body as { name: string };
      const trimmedName = name.trim();
      if (!trimmedName) return reply.code(400).send({ error: 'invalid_name' });

      const tenant = await db.transaction(async (tx) => {
        const [organizationRow] = await tx
          .select({ projectNoun: organizations.projectNoun })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        const [tenantRow] = await tx
          .insert(tenants)
          .values({
            organizationId,
            name: trimmedName,
            slug: await uniqueWorkspaceSlug(tx, trimmedName),
            plan: ctx.tenant.plan,
            projectNoun: organizationRow?.projectNoun ?? 'Project',
            isPersonal: false,
          })
          .returning();
        if (!tenantRow) throw new Error('failed to insert tenant');
        await tx
          .insert(tenantMemberships)
          .values({
            tenantId: tenantRow.id,
            userId: ctx.user.id,
            role: 'tenant_admin',
          })
          .onConflictDoNothing();
        return tenantRow;
      });

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.tenantCreated,
        targetType: 'tenant',
        targetId: tenant.id,
        payload: { organizationId },
      });

      reply.code(201).send({
        tenant: {
          ...publicTenant(tenant),
          role: 'tenant_admin',
          organizationId: tenant.organizationId,
        },
      });
    },
  );

  const updateWorkspaceArchivedState = async (
    req: FastifyRequest<{ Params: { slug: string; workspaceId: string } }>,
    reply: FastifyReply,
    archived: boolean,
  ) => {
    const ctx = await resolveRequestTenantContext(req, req.params.slug);
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!ctx.tenant.organizationId) {
      return reply.code(409).send({ error: 'organization_required' });
    }
    const [orgMembership] = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, ctx.tenant.organizationId),
          eq(organizationMemberships.userId, ctx.user.id),
          isNull(organizationMemberships.revokedAt),
        ),
      )
      .limit(1);
    if (orgMembership?.orgRole !== 'organization_admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (archived && req.params.workspaceId === ctx.tenant.id) {
      return reply.code(409).send({ error: 'cannot_archive_active_workspace' });
    }
    const [target] = await db
      .select()
      .from(tenants)
      .where(
        and(
          eq(tenants.id, req.params.workspaceId),
          eq(tenants.organizationId, ctx.tenant.organizationId),
        ),
      )
      .limit(1);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.isPersonal) {
      return reply.code(409).send({ error: 'cannot_archive_personal_workspace' });
    }
    const [tenant] = await db
      .update(tenants)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(tenants.id, target.id))
      .returning();
    if (!tenant) throw new Error('workspace archive update returned nothing');
    await writeAuditEvent(db, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      actorDeviceId: req.currentDevice?.id,
      category: AUDIT_CATEGORIES.identitySession,
      action: archived
        ? AUDIT_ACTIONS.tenantArchived
        : AUDIT_ACTIONS.tenantRestored,
      targetType: 'tenant',
      targetId: tenant.id,
      payload: { name: tenant.name, slug: tenant.slug },
    });
    return {
      tenant: {
        ...publicTenant(tenant),
        role: 'tenant_admin',
        organizationId: tenant.organizationId,
      },
    };
  };

  app.post<{ Params: { slug: string; workspaceId: string } }>(
    '/tenants/:slug/workspaces/:workspaceId/archive',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => updateWorkspaceArchivedState(req, reply, true),
  );

  app.post<{ Params: { slug: string; workspaceId: string } }>(
    '/tenants/:slug/workspaces/:workspaceId/restore',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => updateWorkspaceArchivedState(req, reply, false),
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      return {
        tenant: publicTenant(ctx.tenant),
        membership: { role: ctx.membership.role },
      };
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /tenants/:slug/organization/settings  (org admin)
  // -----------------------------------------------------------------------
  app.patch<{
    Params: { slug: string };
    Body: { projectNoun: (typeof PROJECT_NOUN_OPTIONS)[number] };
  }>(
    '/tenants/:slug/organization/settings',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['projectNoun'],
          properties: {
            projectNoun: {
              type: 'string',
              enum: PROJECT_NOUN_OPTIONS,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (!ctx.tenant.organizationId) {
        return reply.code(409).send({ error: 'organization_required' });
      }
      const [orgMembership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(
              organizationMemberships.organizationId,
              ctx.tenant.organizationId,
            ),
            eq(organizationMemberships.userId, ctx.user.id),
            isNull(organizationMemberships.revokedAt),
          ),
        )
        .limit(1);
      if (orgMembership?.orgRole !== 'organization_admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { organization, activeTenant } = await db.transaction(async (tx) => {
        const [organizationRow] = await tx
          .update(organizations)
          .set({ projectNoun: req.body.projectNoun, updatedAt: new Date() })
          .where(eq(organizations.id, ctx.tenant.organizationId!))
          .returning();
        if (!organizationRow) {
          throw new Error('organization settings update returned nothing');
        }
        await tx
          .update(tenants)
          .set({ projectNoun: req.body.projectNoun, updatedAt: new Date() })
          .where(eq(tenants.organizationId, ctx.tenant.organizationId!));
        const [activeTenantRow] = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, ctx.tenant.id))
          .limit(1);
        if (!activeTenantRow) {
          throw new Error('active tenant missing after settings update');
        }
        return { organization: organizationRow, activeTenant: activeTenantRow };
      });

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.tenantSettingsUpdated,
        targetType: 'organization',
        targetId: organization.id,
        payload: { projectNoun: organization.projectNoun },
      });

      return {
        organization: {
          id: organization.id,
          name: organization.name,
          projectNoun: organization.projectNoun,
          role: orgMembership.orgRole,
          workspaceAccessMode: orgMembership.workspaceAccessMode,
        },
        tenant: {
          ...publicTenant(activeTenant),
          role: ctx.membership.role,
          organizationId: activeTenant.organizationId,
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/usage  (any member)
  //
  // The Plan & Usage card on the tenant settings page renders from this.
  // Returns the plan's machine-readable limits + the tenant's current
  // counts for the gates we actually enforce (projects, members, monthly
  // attestations). docs/v1 §22.2.
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/usage',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });

      const projectsRow = await db
        .select({ n: drizzleCount() })
        .from(projects)
        .where(eq(projects.tenantId, ctx.tenant.id));
      const usersRow = await db
        .select({ n: drizzleCount() })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, ctx.tenant.id));
      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const attestationsRow = await db
        .select({ n: drizzleCount() })
        .from(attestations)
        .where(
          and(
            eq(attestations.tenantId, ctx.tenant.id),
            gt(attestations.createdAt, monthStart),
          ),
        );

      return {
        plan: ctx.tenant.plan,
        limits: limitsFor(ctx.tenant.plan),
        usage: {
          projects: Number(projectsRow[0]?.n ?? 0),
          users: Number(usersRow[0]?.n ?? 0),
          attestationsThisMonth: Number(attestationsRow[0]?.n ?? 0),
        },
        periodStart: monthStart.toISOString(),
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/members  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/members',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const rows = ctx.tenant.organizationId
        ? await db
            .select({
              userId: organizationMemberships.userId,
              createdAt: organizationMemberships.createdAt,
              email: users.email,
              displayName: users.displayName,
              organizationRole: organizationMemberships.orgRole,
              workspaceAccessMode: organizationMemberships.workspaceAccessMode,
            })
            .from(organizationMemberships)
            .innerJoin(users, eq(users.id, organizationMemberships.userId))
            .where(
              and(
                eq(
                  organizationMemberships.organizationId,
                  ctx.tenant.organizationId,
                ),
                isNull(organizationMemberships.revokedAt),
              ),
            )
        : await db
            .select({
              userId: tenantMemberships.userId,
              createdAt: tenantMemberships.createdAt,
              email: users.email,
              displayName: users.displayName,
              organizationRole: organizationMemberships.orgRole,
              workspaceAccessMode: organizationMemberships.workspaceAccessMode,
            })
            .from(tenantMemberships)
            .innerJoin(users, eq(users.id, tenantMemberships.userId))
            .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
            .leftJoin(
              organizationMemberships,
              and(
                eq(organizationMemberships.organizationId, tenants.organizationId),
                eq(organizationMemberships.userId, tenantMemberships.userId),
              ),
            )
            .where(eq(tenantMemberships.tenantId, ctx.tenant.id));
      const userIds = rows.map((row) => row.userId);
      const workspaceRows =
        userIds.length > 0
          ? await db
              .select({
                userId: tenantMemberships.userId,
                workspaceId: tenants.id,
                workspaceSlug: tenants.slug,
                workspaceName: tenants.name,
                role: tenantMemberships.role,
              })
              .from(tenantMemberships)
              .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
              .where(
                and(
                  inArray(tenantMemberships.userId, userIds),
                  ctx.tenant.organizationId
                    ? eq(tenants.organizationId, ctx.tenant.organizationId)
                    : eq(tenants.id, ctx.tenant.id),
                ),
              )
          : [];
      const workspacesByUser = new Map<
        string,
        Array<{ id: string; slug: string; name: string; role: string }>
      >();
      for (const workspace of workspaceRows) {
        const list = workspacesByUser.get(workspace.userId) ?? [];
        list.push({
          id: workspace.workspaceId,
          slug: workspace.workspaceSlug,
          name: workspace.workspaceName,
          role: workspace.role,
        });
        workspacesByUser.set(workspace.userId, list);
      }

      return {
        members: rows.map((r) => {
          const memberWorkspaces = workspacesByUser.get(r.userId) ?? [];
          const currentWorkspaceRole = memberWorkspaces.find(
            (workspace) => workspace.id === ctx.tenant.id,
          )?.role;
          return {
            userId: r.userId,
            email: r.email,
            displayName: r.displayName,
            role:
              currentWorkspaceRole ??
              memberWorkspaces[0]?.role ??
              (r.organizationRole === 'organization_admin'
                ? 'tenant_admin'
                : 'producer'),
            organizationRole: r.organizationRole ?? 'member',
            workspaceAccessMode:
              r.workspaceAccessMode ?? 'selected_workspaces',
            joinedAt: r.createdAt.toISOString(),
            workspaces: memberWorkspaces,
          };
        }),
      };
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /tenants/:slug/members/:userId/access  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.patch<{ Params: { slug: string; userId: string } }>(
    '/tenants/:slug/members/:userId/access',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ROLE_VALUES as unknown as string[] },
            organizationRole: {
              type: 'string',
              enum: ORGANIZATION_ROLE_VALUES as unknown as string[],
            },
            workspaceAccessMode: {
              type: 'string',
              enum: WORKSPACE_ACCESS_MODE_VALUES as unknown as string[],
            },
            workspaceIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
          },
          anyOf: [
            { required: ['role'] },
            { required: ['organizationRole'] },
            { required: ['workspaceAccessMode'] },
            { required: ['workspaceIds'] },
          ],
        },
      },
    },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);
      if (!ctx.tenant.organizationId) {
        return reply.code(409).send({ error: 'organization_required' });
      }
      const organizationId = ctx.tenant.organizationId;

      const body = req.body as {
        role?: Role;
        organizationRole?: OrganizationRole;
        workspaceAccessMode?: WorkspaceAccessMode;
        workspaceIds?: string[];
      };

      const [targetOrganizationMembership] = await db
        .select({
          userId: organizationMemberships.userId,
          organizationRole: organizationMemberships.orgRole,
          workspaceAccessMode: organizationMemberships.workspaceAccessMode,
          revokedAt: organizationMemberships.revokedAt,
        })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, req.params.userId),
          ),
        )
        .limit(1);
      const targetWorkspaceRows = await db
        .select({
          tenantId: tenantMemberships.tenantId,
          role: tenantMemberships.role,
        })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(
          and(
            eq(tenantMemberships.userId, req.params.userId),
            eq(tenants.organizationId, organizationId),
          ),
        );
      if (!targetOrganizationMembership && targetWorkspaceRows.length === 0) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const currentWorkspaceRole = targetWorkspaceRows.find(
        (workspace) => workspace.tenantId === ctx.tenant.id,
      )?.role;
      const target = {
        userId: req.params.userId,
        role:
          currentWorkspaceRole ??
          targetWorkspaceRows[0]?.role ??
          (targetOrganizationMembership?.organizationRole ===
          'organization_admin'
            ? 'tenant_admin'
            : 'producer'),
        organizationRole:
          targetOrganizationMembership?.organizationRole ?? 'member',
        workspaceAccessMode:
          targetOrganizationMembership?.workspaceAccessMode ??
          'selected_workspaces',
        revokedAt: targetOrganizationMembership?.revokedAt ?? null,
      };

      const nextRole = body.role ?? target.role;
      const nextOrganizationRole =
        body.organizationRole ??
        target.organizationRole ??
        (nextRole === 'tenant_admin' ? 'organization_admin' : 'member');
      const nextWorkspaceAccessMode =
        body.workspaceAccessMode ??
        target.workspaceAccessMode ??
        'selected_workspaces';
      const selectedWorkspaceIds = body.workspaceIds
        ? Array.from(new Set(body.workspaceIds))
        : null;
      const selectedWorkspaces =
        selectedWorkspaceIds && selectedWorkspaceIds.length > 0
          ? await db
              .select({ id: tenants.id })
              .from(tenants)
              .where(
                and(
                  inArray(tenants.id, selectedWorkspaceIds),
                  eq(tenants.organizationId, organizationId),
                  isNull(tenants.archivedAt),
                ),
              )
          : null;
      if (
        selectedWorkspaceIds &&
        selectedWorkspaces?.length !== selectedWorkspaceIds.length
      ) {
        return reply.code(400).send({ error: 'invalid_workspace_selection' });
      }

      if (
        target.userId === ctx.user.id &&
        (nextWorkspaceAccessMode === 'none' ||
          nextRole !== 'tenant_admin' ||
          (selectedWorkspaceIds &&
            !selectedWorkspaceIds.includes(ctx.tenant.id)))
      ) {
        return reply.code(409).send({ error: 'cannot_remove_self' });
      }

      const targetIsActiveOrganizationAdmin =
        target.organizationRole === 'organization_admin' && !target.revokedAt;
      const targetRemainsActiveOrganizationAdmin =
        nextOrganizationRole === 'organization_admin' &&
        nextWorkspaceAccessMode !== 'none';
      if (
        targetIsActiveOrganizationAdmin &&
        !targetRemainsActiveOrganizationAdmin
      ) {
        const organizationAdminCount =
          await countActiveOrganizationAdmins(db, organizationId);
        if (organizationAdminCount <= 1) {
          return reply
            .code(409)
            .send({ error: 'cannot_remove_last_organization_admin' });
        }
      }

      if (target.role === 'tenant_admin') {
        const existingAdminWorkspaces = await db
          .select({ tenantId: tenantMemberships.tenantId })
          .from(tenantMemberships)
          .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
          .where(
            and(
              eq(tenantMemberships.userId, target.userId),
              eq(tenantMemberships.role, 'tenant_admin'),
              eq(tenants.organizationId, organizationId),
            ),
          );
        for (const workspace of existingAdminWorkspaces) {
          const losesAdmin =
            nextRole !== 'tenant_admin' ||
            nextWorkspaceAccessMode === 'none' ||
            (selectedWorkspaceIds &&
              !selectedWorkspaceIds.includes(workspace.tenantId));
          if (!losesAdmin) continue;
          const adminCount = await countActiveAdmins(db, workspace.tenantId);
          if (adminCount <= 1) {
            return reply.code(409).send({ error: 'cannot_remove_last_admin' });
          }
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .insert(organizationMemberships)
          .values({
            organizationId,
            userId: target.userId,
            orgRole: nextOrganizationRole,
            workspaceAccessMode: nextWorkspaceAccessMode,
            revokedAt:
              nextWorkspaceAccessMode === 'none' ? new Date() : null,
          })
          .onConflictDoUpdate({
            target: [
              organizationMemberships.organizationId,
              organizationMemberships.userId,
            ],
            set: {
              orgRole: nextOrganizationRole,
              workspaceAccessMode: nextWorkspaceAccessMode,
              revokedAt:
                nextWorkspaceAccessMode === 'none' ? new Date() : null,
              updatedAt: new Date(),
            },
          });

        if (nextWorkspaceAccessMode === 'none') {
          const organizationWorkspaceRows = await tx
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.organizationId, organizationId));
          const organizationWorkspaceIds = organizationWorkspaceRows.map(
            (workspace) => workspace.id,
          );
          if (organizationWorkspaceIds.length === 0) return;
          await tx
            .delete(tenantMemberships)
            .where(
              and(
                eq(tenantMemberships.userId, target.userId),
                inArray(tenantMemberships.tenantId, organizationWorkspaceIds),
              ),
            );
          return;
        }

        if (selectedWorkspaceIds) {
          const currentWorkspaceRows = await tx
            .select({ tenantId: tenantMemberships.tenantId })
            .from(tenantMemberships)
            .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
            .where(
              and(
                eq(tenantMemberships.userId, target.userId),
                eq(tenants.organizationId, organizationId),
              ),
            );
          for (const current of currentWorkspaceRows) {
            if (selectedWorkspaceIds.includes(current.tenantId)) continue;
            await tx
              .delete(tenantMemberships)
              .where(
                and(
                  eq(tenantMemberships.tenantId, current.tenantId),
                  eq(tenantMemberships.userId, target.userId),
                ),
              );
          }
          for (const workspaceId of selectedWorkspaceIds) {
            await tx
              .insert(tenantMemberships)
              .values({
                tenantId: workspaceId,
                userId: target.userId,
                role: nextRole,
              })
              .onConflictDoUpdate({
                target: [
                  tenantMemberships.tenantId,
                  tenantMemberships.userId,
                ],
                set: { role: nextRole },
              });
          }
        } else {
          await tx
            .update(tenantMemberships)
            .set({ role: nextRole })
            .where(
              and(
                eq(tenantMemberships.tenantId, ctx.tenant.id),
                eq(tenantMemberships.userId, target.userId),
              ),
            );
        }
      });

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.tenantMemberAccessChanged,
        targetType: 'user',
        targetId: target.userId,
        payload: {
          previous: {
            role: target.role,
            organizationRole: target.organizationRole ?? 'member',
            workspaceAccessMode:
              target.workspaceAccessMode ?? 'selected_workspaces',
            revoked: Boolean(target.revokedAt),
          },
          next: {
            role: nextWorkspaceAccessMode === 'none' ? null : nextRole,
            organizationRole: nextOrganizationRole,
            workspaceAccessMode: nextWorkspaceAccessMode,
            revoked: nextWorkspaceAccessMode === 'none',
            workspaceIds: selectedWorkspaceIds,
          },
        },
      });

      return {
        member: {
          userId: target.userId,
          role: nextWorkspaceAccessMode === 'none' ? null : nextRole,
          organizationRole: nextOrganizationRole,
          workspaceAccessMode: nextWorkspaceAccessMode,
          revoked: nextWorkspaceAccessMode === 'none',
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /tenants/:slug/members/:userId  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.delete<{ Params: { slug: string; userId: string } }>(
    '/tenants/:slug/members/:userId',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const targetRows = await db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenant.id),
            eq(tenantMemberships.userId, req.params.userId),
          ),
        )
        .limit(1);
      const target = targetRows[0];
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (target.userId === ctx.user.id) {
        return reply.code(409).send({ error: 'cannot_remove_self' });
      }

      // Guard: don't remove the last admin (would orphan the tenant).
      if (target.role === 'tenant_admin') {
        const adminCount = await countActiveAdmins(db, ctx.tenant.id);
        if (adminCount <= 1) {
          return reply.code(409).send({ error: 'cannot_remove_last_admin' });
        }
      }

      await db
        .delete(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenant.id),
            eq(tenantMemberships.userId, req.params.userId),
          ),
        );

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.basicAdmin,
        action: AUDIT_ACTIONS.tenantMemberRemoved,
        targetType: 'user',
        targetId: req.params.userId,
        payload: { role: target.role },
      });

      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/invitations  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/tenants/:slug/invitations',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'role'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            role: { type: 'string', enum: ROLE_VALUES as unknown as string[] },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const { email, role } = req.body as { email: string; role: Role };
      const normalizedEmail = normalizeEmail(email);
      if (!emailLooksValid(normalizedEmail)) {
        return reply.code(400).send({ error: 'invalid_email' });
      }

      // If a matching user already has a membership, reject — invitations are
      // for non-members. (Role changes for existing members aren't a V1 path.)
      const existingMember = await db
        .select({ userId: tenantMemberships.userId })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenant.id),
            eq(users.email, normalizedEmail),
          ),
        )
        .limit(1);
      if (existingMember[0]) {
        return reply.code(409).send({ error: 'already_member' });
      }

      // User cap (docs/v1 §22.2; Free 1, Team Starter 3, Team Pro 10,
      // Enterprise null). We check at invitation time so admins get the
      // signal before sending out an unfulfillable invite. Outstanding
      // invites are NOT counted yet — only confirmed memberships count.
      const userCap = await checkUserCountLimit(
        db,
        ctx.tenant.id,
        ctx.tenant.plan,
      );
      if (!userCap.ok) {
        return reply.code(409).send({
          error: userCap.error,
          limit: userCap.limit,
          current: userCap.current,
        });
      }

      // Revoke any prior active invitation for the same {tenant, email}.
      const replacedInvitations = await db
        .update(tenantInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(tenantInvitations.tenantId, ctx.tenant.id),
            eq(tenantInvitations.email, normalizedEmail),
            isNull(tenantInvitations.acceptedAt),
            isNull(tenantInvitations.revokedAt),
          ),
        )
        .returning({
          id: tenantInvitations.id,
          email: tenantInvitations.email,
          role: tenantInvitations.role,
        });
      for (const replaced of replacedInvitations) {
        await writeAuditEvent(db, {
          tenantId: ctx.tenant.id,
          actorUserId: ctx.user.id,
          actorDeviceId: req.currentDevice?.id,
          category: AUDIT_CATEGORIES.accessControl,
          action: AUDIT_ACTIONS.tenantInvitationRevoked,
          targetType: 'tenant_invitation',
          targetId: replaced.id,
          payload: {
            email: replaced.email,
            role: replaced.role,
            reason: 'replaced_by_new_invitation',
          },
        });
      }

      const { token, hash } = generateToken();
      const insertRows = await db
        .insert(tenantInvitations)
        .values({
          tenantId: ctx.tenant.id,
          invitedByUserId: ctx.user.id,
          email: normalizedEmail,
          role,
          tokenHash: hash,
          expiresAt: minutesFromNow(INVITATION_TTL_MINUTES),
        })
        .returning();
      const inviteRow = insertRows[0];
      if (!inviteRow) throw new Error('failed to insert invitation');

      await notifications.sendTenantInvitation({
        to: normalizedEmail,
        tenantName: ctx.tenant.name,
        tenantSlug: ctx.tenant.slug,
        invitedByEmail: ctx.user.email,
        role,
        token,
      });

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.tenantInvitationCreated,
        targetType: 'tenant_invitation',
        targetId: inviteRow.id,
        payload: { email: normalizedEmail, role },
      });

      reply.code(201).send({
        invitation: {
          id: inviteRow.id,
          email: inviteRow.email,
          role: inviteRow.role,
          createdAt: inviteRow.createdAt.toISOString(),
          expiresAt: inviteRow.expiresAt.toISOString(),
        },
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/invitations  (tenant_admin only) — active invites
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/invitations',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const rows = await db
        .select()
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.tenantId, ctx.tenant.id),
            isNull(tenantInvitations.acceptedAt),
            isNull(tenantInvitations.revokedAt),
          ),
        );

      return {
        invitations: rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/invitations/:id/revoke  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string; id: string } }>(
    '/tenants/:slug/invitations/:id/revoke',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const rows = await db
        .select()
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.id, req.params.id),
            eq(tenantInvitations.tenantId, ctx.tenant.id),
          ),
        )
        .limit(1);
      const invitation = rows[0];
      if (!invitation) return reply.code(404).send({ error: 'not_found' });
      if (invitation.acceptedAt || invitation.revokedAt) {
        return reply.code(409).send({ error: 'invitation_not_active' });
      }

      await db
        .update(tenantInvitations)
        .set({ revokedAt: new Date() })
        .where(eq(tenantInvitations.id, invitation.id));

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.tenantInvitationRevoked,
        targetType: 'tenant_invitation',
        targetId: invitation.id,
      });

      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/audit  (tenant_admin full, producer limited)
  //
  // Read-only audit log. Role + plan decide which categories are visible
  // (docs/v1 §8.5, §19.3). Newest first; ?limit caps the page (default 100,
  // max 200).
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string };
    Querystring: { limit?: string };
  }>(
    '/tenants/:slug/audit',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });

      const visibility = auditVisibility(ctx.membership.role, ctx.tenant.plan);
      if (visibility === 'denied') {
        throw app.httpErrors.forbidden();
      }

      const parsedLimit = Number(req.query.limit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 200)
          : 100;

      const tenantFilter = eq(auditEvents.tenantId, ctx.tenant.id);
      const where =
        visibility.categories === null
          ? tenantFilter
          : and(
              tenantFilter,
              inArray(auditEvents.category, [...visibility.categories]),
            );

      const rows = await db
        .select({
          id: auditEvents.id,
          category: auditEvents.category,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          payload: auditEvents.payload,
          actorUserId: auditEvents.actorUserId,
          actorDeviceId: auditEvents.actorDeviceId,
          actorEmail: users.email,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(where)
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit);

      return {
        events: rows.map((r) => ({
          id: r.id,
          category: r.category,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          payload: r.payload,
          actorUserId: r.actorUserId,
          actorDeviceId: r.actorDeviceId,
          actorEmail: r.actorEmail,
          createdAt: r.createdAt.toISOString(),
        })),
        scope: visibility.categories === null ? 'full' : 'limited',
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/organization/audit/export  (org admin only)
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string };
    Querystring: {
      format?: 'json' | 'csv';
      actorUserId?: string;
      category?: string;
      projectId?: string;
      workspaceId?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>(
    '/tenants/:slug/organization/audit/export',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (!ctx.tenant.organizationId) {
        return reply.code(409).send({ error: 'organization_required' });
      }
      const organizationId = ctx.tenant.organizationId;
      const [orgMembership] = await db
        .select({ organizationRole: organizationMemberships.orgRole })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, ctx.user.id),
            isNull(organizationMemberships.revokedAt),
          ),
        )
        .limit(1);
      if (orgMembership?.organizationRole !== 'organization_admin') {
        throw app.httpErrors.forbidden();
      }

      const format = req.query.format === 'csv' ? 'csv' : 'json';
      const from = parseExportDate(req.query.from);
      const to = parseExportDate(req.query.to);
      if ((req.query.from && !from) || (req.query.to && !to)) {
        return reply.code(400).send({ error: 'invalid_date_filter' });
      }

      const parsedLimit = Number(req.query.limit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 10000)
          : 10000;

      const conditions = [eq(tenants.organizationId, organizationId)];
      if (req.query.workspaceId) {
        conditions.push(eq(auditEvents.tenantId, req.query.workspaceId));
      }
      if (req.query.actorUserId) {
        conditions.push(eq(auditEvents.actorUserId, req.query.actorUserId));
      }
      if (req.query.category) {
        conditions.push(eq(auditEvents.category, req.query.category));
      }
      if (req.query.projectId) {
        conditions.push(
          and(
            eq(auditEvents.targetType, 'project'),
            eq(auditEvents.targetId, req.query.projectId),
          )!,
        );
      }
      if (from) conditions.push(gte(auditEvents.createdAt, from));
      if (to) conditions.push(lte(auditEvents.createdAt, to));

      const rows = await db
        .select({
          id: auditEvents.id,
          tenantId: tenants.id,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          category: auditEvents.category,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          payload: auditEvents.payload,
          actorUserId: auditEvents.actorUserId,
          actorDeviceId: auditEvents.actorDeviceId,
          actorEmail: users.email,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .innerJoin(tenants, eq(tenants.id, auditEvents.tenantId))
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(and(...conditions))
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit);

      const filters: AuditExportFilters = {
        actorUserId: req.query.actorUserId ?? null,
        category: req.query.category ?? null,
        projectId: req.query.projectId ?? null,
        workspaceId: req.query.workspaceId ?? null,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      };

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.auditIntegrity,
        action: AUDIT_ACTIONS.auditExportCreated,
        targetType: 'organization_audit_export',
        targetId: organizationId,
        payload: { format, filters, rowCount: rows.length, limit },
      });

      const exportedAt = new Date().toISOString();
      const filename = `proveria-organization-events-${exportedAt.slice(0, 10)}.${format}`;
      reply.header(
        'content-disposition',
        `attachment; filename="${filename}"`,
      );

      if (format === 'csv') {
        reply.type('text/csv; charset=utf-8');
        return auditExportCsv(rows, true);
      }

      reply.type('application/json; charset=utf-8');
      return {
        export: {
          organization: { id: organizationId },
          activeWorkspace: {
            id: ctx.tenant.id,
            slug: ctx.tenant.slug,
            name: ctx.tenant.name,
          },
          format,
          exportedAt,
          filters,
          rowCount: rows.length,
          limit,
        },
        events: auditExportEvents(rows, true),
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/audit/export  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string };
    Querystring: {
      format?: 'json' | 'csv';
      actorUserId?: string;
      category?: string;
      projectId?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>(
    '/tenants/:slug/audit/export',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const format = req.query.format === 'csv' ? 'csv' : 'json';
      const from = parseExportDate(req.query.from);
      const to = parseExportDate(req.query.to);
      if ((req.query.from && !from) || (req.query.to && !to)) {
        return reply.code(400).send({ error: 'invalid_date_filter' });
      }

      const parsedLimit = Number(req.query.limit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 5000)
          : 5000;

      const conditions = [eq(auditEvents.tenantId, ctx.tenant.id)];
      if (req.query.actorUserId) {
        conditions.push(eq(auditEvents.actorUserId, req.query.actorUserId));
      }
      if (req.query.category) {
        conditions.push(eq(auditEvents.category, req.query.category));
      }
      if (req.query.projectId) {
        conditions.push(
          and(
            eq(auditEvents.targetType, 'project'),
            eq(auditEvents.targetId, req.query.projectId),
          )!,
        );
      }
      if (from) conditions.push(gte(auditEvents.createdAt, from));
      if (to) conditions.push(lte(auditEvents.createdAt, to));

      const rows = await db
        .select({
          id: auditEvents.id,
          tenantId: tenants.id,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          category: auditEvents.category,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          payload: auditEvents.payload,
          actorUserId: auditEvents.actorUserId,
          actorDeviceId: auditEvents.actorDeviceId,
          actorEmail: users.email,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .innerJoin(tenants, eq(tenants.id, auditEvents.tenantId))
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(and(...conditions))
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit);

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.auditIntegrity,
        action: AUDIT_ACTIONS.auditExportCreated,
        targetType: 'audit_export',
        payload: {
          format,
          filters: {
            actorUserId: req.query.actorUserId ?? null,
            category: req.query.category ?? null,
            projectId: req.query.projectId ?? null,
            from: from?.toISOString() ?? null,
            to: to?.toISOString() ?? null,
          },
          rowCount: rows.length,
          limit,
        },
      });

      const exportedAt = new Date().toISOString();
      const filename = `proveria-${ctx.tenant.slug}-events-${exportedAt.slice(0, 10)}.${format}`;
      reply.header(
        'content-disposition',
        `attachment; filename="${filename}"`,
      );

      if (format === 'csv') {
        reply.type('text/csv; charset=utf-8');
        return auditExportCsv(rows, false);
      }

      reply.type('application/json; charset=utf-8');
      return {
        export: {
          tenant: {
            id: ctx.tenant.id,
            slug: ctx.tenant.slug,
            name: ctx.tenant.name,
          },
          format,
          exportedAt,
          filters: {
            actorUserId: req.query.actorUserId ?? null,
            category: req.query.category ?? null,
            projectId: req.query.projectId ?? null,
            from: from?.toISOString() ?? null,
            to: to?.toISOString() ?? null,
          },
          rowCount: rows.length,
          limit,
        },
        events: auditExportEvents(rows, false),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/audit/checkpoint  (tenant_admin, Enterprise only)
  //
  // Creates a Merkle-root checkpoint over the chain entries since the last
  // checkpoint (docs/v1 §19.4). Uses Protocol V1 lex-sort Merkle (same
  // helpers as attestations) — order is captured separately by first_seq +
  // last_seq + the linear chain links. Returns the new checkpoint.
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/tenants/:slug/audit/checkpoint',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (ctx.membership.role !== 'tenant_admin') {
        throw app.httpErrors.forbidden();
      }
      if (ctx.tenant.plan !== 'enterprise') {
        return reply.code(409).send({ error: 'enterprise_only' });
      }

      // Find the last checkpoint's last_seq, then pull every chain entry past it.
      const [last] = await db
        .select({ lastSeq: auditCheckpoints.lastSeq })
        .from(auditCheckpoints)
        .where(eq(auditCheckpoints.tenantId, ctx.tenant.id))
        .orderBy(desc(auditCheckpoints.lastSeq))
        .limit(1);
      const startSeq = (last?.lastSeq ?? 0) + 1;

      const rows = await db
        .select({
          sequenceNum: auditEventHashChain.sequenceNum,
          thisHash: auditEventHashChain.thisHash,
        })
        .from(auditEventHashChain)
        .where(
          and(
            eq(auditEventHashChain.tenantId, ctx.tenant.id),
            gt(auditEventHashChain.sequenceNum, startSeq - 1),
          ),
        )
        .orderBy(asc(auditEventHashChain.sequenceNum));

      if (rows.length === 0) {
        return reply.code(409).send({
          error: 'no_new_chain_entries',
          message:
            'No audit chain entries to checkpoint since the last checkpoint.',
        });
      }

      const firstSeq = rows[0]!.sequenceNum;
      const lastSeq = rows[rows.length - 1]!.sequenceNum;
      const leafBytes = rows.map(
        (r) => new Uint8Array(Buffer.from(r.thisHash, 'hex')),
      );
      const rootBytes = computeMerkleRoot(leafBytes);
      const merkleRoot = Buffer.from(rootBytes).toString('hex');

      const [inserted] = await db
        .insert(auditCheckpoints)
        .values({
          tenantId: ctx.tenant.id,
          firstSeq,
          lastSeq,
          merkleRoot,
          createdByUserId: ctx.user.id,
        })
        .returning();
      if (!inserted) throw new Error('failed to insert checkpoint');

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.cryptographic,
        action: AUDIT_ACTIONS.auditCheckpointCreated,
        targetType: 'audit_checkpoint',
        targetId: inserted.id,
        payload: { firstSeq, lastSeq, merkleRoot },
      });

      reply.code(201).send({
        checkpoint: {
          id: inserted.id,
          firstSeq,
          lastSeq,
          merkleRoot,
          createdAt: inserted.createdAt.toISOString(),
        },
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/evidence-export/manifest  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string };
    Querystring: {
      scope?: EvidenceExportScope;
      projectId?: string;
      actorUserId?: string;
      includeEvents?: string;
      limit?: string;
    };
  }>(
    '/tenants/:slug/evidence-export/manifest',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const parsedLimit = Number(req.query.limit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 1000)
          : 1000;
      const includeEvents = req.query.includeEvents === 'true';
      const scope = parseEvidenceExportScope(req.query.scope);
      const targets = await resolveEvidenceExportTargets(app, db, ctx, scope);

      const conditions = [inArray(attestations.tenantId, targets.tenantIds)];
      if (req.query.projectId) {
        conditions.push(eq(attestations.projectId, req.query.projectId));
      }
      if (req.query.actorUserId) {
        conditions.push(
          eq(attestations.createdByUserId, req.query.actorUserId),
        );
      }

      const attestationRows = await db
        .select({
          id: attestations.id,
          label: attestations.label,
          state: attestations.state,
          tenantId: attestations.tenantId,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          projectId: attestations.projectId,
          projectSlug: projects.slug,
          projectName: projects.name,
          createdByUserId: attestations.createdByUserId,
          confirmedAttemptId: attestations.confirmedAttemptId,
          manifestObjectKey: attestations.manifestObjectKey,
          leavesObjectKey: attestations.leavesObjectKey,
          receiptJsonObjectKey: attestations.receiptJsonObjectKey,
          receiptPdfObjectKey: attestations.receiptPdfObjectKey,
          packageId: attestations.packageId,
          merkleRoot: attestations.merkleRoot,
          createdAt: attestations.createdAt,
          confirmedAt: attestations.confirmedAt,
        })
        .from(attestations)
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .innerJoin(tenants, eq(tenants.id, attestations.tenantId))
        .where(and(...conditions))
        .orderBy(desc(attestations.createdAt))
        .limit(limit);

      const attestationIds = attestationRows.map((row) => row.id);
      const attemptRows =
        attestationIds.length > 0
          ? await db
              .select({
                id: submissionAttempts.id,
                attestationId: submissionAttempts.attestationId,
                state: submissionAttempts.state,
                manifestObjectKey: submissionAttempts.manifestObjectKey,
                leavesObjectKey: submissionAttempts.leavesObjectKey,
                validationResultObjectKey:
                  submissionAttempts.validationResultObjectKey,
                validationError: submissionAttempts.validationError,
                createdAt: submissionAttempts.createdAt,
                uploadedAt: submissionAttempts.uploadedAt,
                validatedAt: submissionAttempts.validatedAt,
                failedAt: submissionAttempts.failedAt,
              })
              .from(submissionAttempts)
              .where(inArray(submissionAttempts.attestationId, attestationIds))
              .orderBy(desc(submissionAttempts.createdAt))
          : [];
      const resultRows =
        attestationIds.length > 0
          ? await db
              .select({
                id: verificationResults.id,
                packageId: verificationResults.packageId,
                attestationId: verificationResults.attestationId,
                lookedUpByUserId: verificationResults.lookedUpByUserId,
                resultType: verificationResults.resultType,
                submittedHash: verificationResults.submittedHash,
                resultObjectKey: verificationResults.resultObjectKey,
                signed: verificationResults.signed,
                createdAt: verificationResults.createdAt,
              })
              .from(verificationResults)
              .where(inArray(verificationResults.attestationId, attestationIds))
              .orderBy(desc(verificationResults.createdAt))
          : [];
      const linkRefs = [
        ...attestationIds,
        ...resultRows.map((row) => row.packageId),
      ];
      const linkRows =
        linkRefs.length > 0
          ? await db
              .select({
                id: verificationLinks.id,
                targetType: verificationLinks.targetType,
                targetRef: verificationLinks.targetRef,
                createdAt: verificationLinks.createdAt,
                expiresAt: verificationLinks.expiresAt,
                revokedAt: verificationLinks.revokedAt,
              })
              .from(verificationLinks)
              .where(
                and(
                  inArray(verificationLinks.tenantId, targets.tenantIds),
                  inArray(verificationLinks.targetRef, linkRefs),
                ),
              )
              .orderBy(desc(verificationLinks.createdAt))
          : [];
      const eventRows =
        includeEvents && attestationIds.length > 0
          ? await db
              .select({
                id: auditEvents.id,
                action: auditEvents.action,
                category: auditEvents.category,
                targetType: auditEvents.targetType,
                targetId: auditEvents.targetId,
                actorUserId: auditEvents.actorUserId,
                createdAt: auditEvents.createdAt,
              })
              .from(auditEvents)
              .where(
                and(
                  inArray(auditEvents.tenantId, targets.tenantIds),
                  inArray(auditEvents.targetId, attestationIds),
                ),
              )
              .orderBy(desc(auditEvents.createdAt))
          : [];

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.evidenceExport,
        action: AUDIT_ACTIONS.evidenceExportCreated,
        targetType: 'evidence_export_manifest',
        payload: {
          filters: {
            scope,
            projectId: req.query.projectId ?? null,
            actorUserId: req.query.actorUserId ?? null,
            includeEvents,
          },
          organizationId: targets.organization?.id ?? null,
          workspaceCount: targets.workspaces.length,
          attestationCount: attestationRows.length,
          attemptCount: attemptRows.length,
          verificationResultCount: resultRows.length,
          linkCount: linkRows.length,
          limit,
        },
      });

      return {
        export: {
          type: 'evidence_manifest',
          scope,
          tenant: {
            id: ctx.tenant.id,
            slug: ctx.tenant.slug,
            name: ctx.tenant.name,
          },
          organization: targets.organization,
          workspaces: targets.workspaces,
          generatedAt: new Date().toISOString(),
          filters: {
            scope,
            projectId: req.query.projectId ?? null,
            actorUserId: req.query.actorUserId ?? null,
            includeEvents,
          },
          counts: {
            attestations: attestationRows.length,
            attempts: attemptRows.length,
            verificationResults: resultRows.length,
            verificationLinks: linkRows.length,
            events: eventRows.length,
          },
        },
        attestations: attestationRows.map((attestation) => ({
          id: attestation.id,
          label: attestation.label,
          state: attestation.state,
          workspace: {
            id: attestation.tenantId,
            slug: attestation.tenantSlug,
            name: attestation.tenantName,
          },
          project: {
            id: attestation.projectId,
            slug: attestation.projectSlug,
            name: attestation.projectName,
          },
          createdByUserId: attestation.createdByUserId,
          createdAt: attestation.createdAt.toISOString(),
          confirmedAt: attestation.confirmedAt?.toISOString() ?? null,
          packageId: attestation.packageId,
          merkleRoot: attestation.merkleRoot,
          artifacts: {
            manifest: attestation.manifestObjectKey,
            leaves: attestation.leavesObjectKey,
            receiptJson: attestation.receiptJsonObjectKey,
            receiptPdf: attestation.receiptPdfObjectKey,
          },
          confirmedAttemptId: attestation.confirmedAttemptId,
        })),
        attempts: attemptRows.map((attempt) => ({
          id: attempt.id,
          attestationId: attempt.attestationId,
          state: attempt.state,
          validationError: attempt.validationError,
          createdAt: attempt.createdAt.toISOString(),
          uploadedAt: attempt.uploadedAt?.toISOString() ?? null,
          validatedAt: attempt.validatedAt?.toISOString() ?? null,
          failedAt: attempt.failedAt?.toISOString() ?? null,
          artifacts: {
            manifest: attempt.manifestObjectKey,
            leaves: attempt.leavesObjectKey,
            validationResult: attempt.validationResultObjectKey,
          },
        })),
        verificationResults: resultRows.map((result) => ({
          id: result.id,
          packageId: result.packageId,
          attestationId: result.attestationId,
          lookedUpByUserId: result.lookedUpByUserId,
          resultType: result.resultType,
          submittedHash: result.submittedHash,
          signed: result.signed === 'true',
          createdAt: result.createdAt.toISOString(),
          artifacts: {
            resultJson: result.resultObjectKey,
          },
        })),
        verificationLinks: linkRows.map((link) => ({
          id: link.id,
          targetType: link.targetType,
          targetRef: link.targetRef,
          createdAt: link.createdAt.toISOString(),
          expiresAt: link.expiresAt?.toISOString() ?? null,
          revokedAt: link.revokedAt?.toISOString() ?? null,
        })),
        events: eventRows.map((event) => ({
          id: event.id,
          action: event.action,
          category: event.category,
          targetType: event.targetType,
          targetId: event.targetId,
          actorUserId: event.actorUserId,
          createdAt: event.createdAt.toISOString(),
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/evidence-export/jobs  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string };
    Querystring: { limit?: string };
  }>(
    '/tenants/:slug/evidence-export/jobs',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const parsedLimit = Number(req.query.limit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 100)
          : 25;

      const rows = await db
        .select({
          id: exportJobs.id,
          kind: exportJobs.kind,
          status: exportJobs.status,
          filters: exportJobs.filters,
          artifactCount: exportJobs.artifactCount,
          rowCount: exportJobs.rowCount,
          resultObjectKey: exportJobs.resultObjectKey,
          error: exportJobs.error,
          progressPercent: exportJobs.progressPercent,
          retryCount: exportJobs.retryCount,
          maxRetries: exportJobs.maxRetries,
          expiresAt: exportJobs.expiresAt,
          retentionPolicy: exportJobs.retentionPolicy,
          createdAt: exportJobs.createdAt,
          startedAt: exportJobs.startedAt,
          completedAt: exportJobs.completedAt,
        })
        .from(exportJobs)
        .where(eq(exportJobs.tenantId, ctx.tenant.id))
        .orderBy(desc(exportJobs.createdAt))
        .limit(limit);

      return {
        jobs: rows.map(publicExportJob),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/evidence-export/jobs/cleanup-expired  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.post<{
    Params: { slug: string };
  }>(
    '/tenants/:slug/evidence-export/jobs/cleanup-expired',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      return await cleanupExpiredEvidenceExports({
        db,
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        deleteObject: removeObject,
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/evidence-export/jobs/:jobId  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string; jobId: string };
  }>(
    '/tenants/:slug/evidence-export/jobs/:jobId',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const [job] = await db
        .select()
        .from(exportJobs)
        .where(
          and(
            eq(exportJobs.tenantId, ctx.tenant.id),
            eq(exportJobs.id, req.params.jobId),
          ),
        )
        .limit(1);

      if (!job) return reply.code(404).send({ error: 'not_found' });

      return {
        job: publicExportJob(job),
        manifest: job.manifest,
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/evidence-export/jobs/:jobId/bundle  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.get<{
    Params: { slug: string; jobId: string };
  }>(
    '/tenants/:slug/evidence-export/jobs/:jobId/bundle',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const [job] = await db
        .select()
        .from(exportJobs)
        .where(
          and(
            eq(exportJobs.tenantId, ctx.tenant.id),
            eq(exportJobs.id, req.params.jobId),
          ),
        )
        .limit(1);

      if (!job) return reply.code(404).send({ error: 'not_found' });
      if (!job.resultObjectKey) {
        return reply.code(404).send({ error: 'bundle_not_available' });
      }
      const bytes = await readObjectBytes(job.resultObjectKey);
      if (!bytes) return reply.code(404).send({ error: 'bundle_not_available' });

      return reply
        .header('content-type', 'application/json')
        .header(
          'content-disposition',
          `attachment; filename="proveria-evidence-bundle-${job.id}.json"`,
        )
        .send(bytes);
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/evidence-export/jobs  (tenant_admin only)
  // -----------------------------------------------------------------------
  app.post<{
    Params: { slug: string };
    Body: {
      scope?: EvidenceExportScope;
      projectId?: string;
      actorUserId?: string;
      includeEvents?: boolean;
      limit?: number;
    };
  }>(
    '/tenants/:slug/evidence-export/jobs',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureRole(app, ctx, ['tenant_admin']);

      const body = req.body ?? {};
      const parsedLimit = Number(body.limit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 1000)
          : 1000;
      const includeEvents = body.includeEvents !== false;
      const scope = parseEvidenceExportScope(body.scope);
      const targets = await resolveEvidenceExportTargets(app, db, ctx, scope);

      const conditions = [inArray(attestations.tenantId, targets.tenantIds)];
      if (body.projectId) {
        conditions.push(eq(attestations.projectId, body.projectId));
      }
      if (body.actorUserId) {
        conditions.push(eq(attestations.createdByUserId, body.actorUserId));
      }

      const attestationRows = await db
        .select({
          id: attestations.id,
          label: attestations.label,
          state: attestations.state,
          tenantId: attestations.tenantId,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          projectId: attestations.projectId,
          projectSlug: projects.slug,
          projectName: projects.name,
          createdByUserId: attestations.createdByUserId,
          manifestObjectKey: attestations.manifestObjectKey,
          leavesObjectKey: attestations.leavesObjectKey,
          receiptJsonObjectKey: attestations.receiptJsonObjectKey,
          receiptPdfObjectKey: attestations.receiptPdfObjectKey,
          packageId: attestations.packageId,
          merkleRoot: attestations.merkleRoot,
          createdAt: attestations.createdAt,
          confirmedAt: attestations.confirmedAt,
        })
        .from(attestations)
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .innerJoin(tenants, eq(tenants.id, attestations.tenantId))
        .where(and(...conditions))
        .orderBy(desc(attestations.createdAt))
        .limit(limit);

      const attestationIds = attestationRows.map((row) => row.id);
      const attemptRows =
        attestationIds.length > 0
          ? await db
              .select({
                id: submissionAttempts.id,
                attestationId: submissionAttempts.attestationId,
                state: submissionAttempts.state,
                manifestObjectKey: submissionAttempts.manifestObjectKey,
                leavesObjectKey: submissionAttempts.leavesObjectKey,
                validationResultObjectKey:
                  submissionAttempts.validationResultObjectKey,
                validationError: submissionAttempts.validationError,
                createdAt: submissionAttempts.createdAt,
                uploadedAt: submissionAttempts.uploadedAt,
                validatedAt: submissionAttempts.validatedAt,
                failedAt: submissionAttempts.failedAt,
              })
              .from(submissionAttempts)
              .where(inArray(submissionAttempts.attestationId, attestationIds))
              .orderBy(desc(submissionAttempts.createdAt))
          : [];
      const resultRows =
        attestationIds.length > 0
          ? await db
              .select({
                id: verificationResults.id,
                packageId: verificationResults.packageId,
                attestationId: verificationResults.attestationId,
                lookedUpByUserId: verificationResults.lookedUpByUserId,
                resultType: verificationResults.resultType,
                submittedHash: verificationResults.submittedHash,
                resultObjectKey: verificationResults.resultObjectKey,
                signed: verificationResults.signed,
                createdAt: verificationResults.createdAt,
              })
              .from(verificationResults)
              .where(inArray(verificationResults.attestationId, attestationIds))
              .orderBy(desc(verificationResults.createdAt))
          : [];
      const linkRefs = [
        ...attestationIds,
        ...resultRows.map((row) => row.packageId),
      ];
      const linkRows =
        linkRefs.length > 0
          ? await db
              .select({
                id: verificationLinks.id,
                targetType: verificationLinks.targetType,
                targetRef: verificationLinks.targetRef,
                createdAt: verificationLinks.createdAt,
                expiresAt: verificationLinks.expiresAt,
                revokedAt: verificationLinks.revokedAt,
              })
              .from(verificationLinks)
              .where(
                and(
                  inArray(verificationLinks.tenantId, targets.tenantIds),
                  inArray(verificationLinks.targetRef, linkRefs),
                ),
              )
              .orderBy(desc(verificationLinks.createdAt))
          : [];
      const eventRows =
        includeEvents && attestationIds.length > 0
          ? await db
              .select({
                id: auditEvents.id,
                action: auditEvents.action,
                category: auditEvents.category,
                targetType: auditEvents.targetType,
                targetId: auditEvents.targetId,
                actorUserId: auditEvents.actorUserId,
                createdAt: auditEvents.createdAt,
              })
              .from(auditEvents)
              .where(
                and(
                  inArray(auditEvents.tenantId, targets.tenantIds),
                  inArray(auditEvents.targetId, attestationIds),
                ),
              )
              .orderBy(desc(auditEvents.createdAt))
          : [];

      const filters = {
        scope,
        projectId: body.projectId ?? null,
        actorUserId: body.actorUserId ?? null,
        includeEvents,
      };
      const manifest = {
        export: {
          type: 'evidence_export_job_manifest',
          scope,
          tenant: {
            id: ctx.tenant.id,
            slug: ctx.tenant.slug,
            name: ctx.tenant.name,
          },
          organization: targets.organization,
          workspaces: targets.workspaces,
          generatedAt: new Date().toISOString(),
          filters,
          counts: {
            attestations: attestationRows.length,
            attempts: attemptRows.length,
            verificationResults: resultRows.length,
            verificationLinks: linkRows.length,
            events: eventRows.length,
          },
        },
        attestations: attestationRows.map((attestation) => ({
          id: attestation.id,
          label: attestation.label,
          state: attestation.state,
          workspace: {
            id: attestation.tenantId,
            slug: attestation.tenantSlug,
            name: attestation.tenantName,
          },
          project: {
            id: attestation.projectId,
            slug: attestation.projectSlug,
            name: attestation.projectName,
          },
          createdByUserId: attestation.createdByUserId,
          createdAt: attestation.createdAt.toISOString(),
          confirmedAt: attestation.confirmedAt?.toISOString() ?? null,
          packageId: attestation.packageId,
          merkleRoot: attestation.merkleRoot,
          artifacts: {
            manifest: attestation.manifestObjectKey,
            leaves: attestation.leavesObjectKey,
            receiptJson: attestation.receiptJsonObjectKey,
            receiptPdf: attestation.receiptPdfObjectKey,
          },
        })),
        attempts: attemptRows.map((attempt) => ({
          id: attempt.id,
          attestationId: attempt.attestationId,
          state: attempt.state,
          validationError: attempt.validationError,
          createdAt: attempt.createdAt.toISOString(),
          uploadedAt: attempt.uploadedAt?.toISOString() ?? null,
          validatedAt: attempt.validatedAt?.toISOString() ?? null,
          failedAt: attempt.failedAt?.toISOString() ?? null,
          artifacts: {
            manifest: attempt.manifestObjectKey,
            leaves: attempt.leavesObjectKey,
            validationResult: attempt.validationResultObjectKey,
          },
        })),
        verificationResults: resultRows.map((result) => ({
          id: result.id,
          packageId: result.packageId,
          attestationId: result.attestationId,
          lookedUpByUserId: result.lookedUpByUserId,
          resultType: result.resultType,
          submittedHash: result.submittedHash,
          signed: result.signed === 'true',
          createdAt: result.createdAt.toISOString(),
          artifacts: {
            resultJson: result.resultObjectKey,
          },
        })),
        verificationLinks: linkRows.map((link) => ({
          id: link.id,
          targetType: link.targetType,
          targetRef: link.targetRef,
          createdAt: link.createdAt.toISOString(),
          expiresAt: link.expiresAt?.toISOString() ?? null,
          revokedAt: link.revokedAt?.toISOString() ?? null,
        })),
        events: eventRows.map((event) => ({
          id: event.id,
          action: event.action,
          category: event.category,
          targetType: event.targetType,
          targetId: event.targetId,
          actorUserId: event.actorUserId,
          createdAt: event.createdAt.toISOString(),
        })),
      };
      const artifactCount = [
        ...attestationRows.flatMap((row) => [
          row.manifestObjectKey,
          row.leavesObjectKey,
          row.receiptJsonObjectKey,
          row.receiptPdfObjectKey,
        ]),
        ...attemptRows.flatMap((row) => [
          row.manifestObjectKey,
          row.leavesObjectKey,
          row.validationResultObjectKey,
        ]),
        ...resultRows.map((row) => row.resultObjectKey),
      ].filter(Boolean).length;
      const rowCount =
        attestationRows.length +
        attemptRows.length +
        resultRows.length +
        linkRows.length +
        eventRows.length;

      const [job] = await db
        .insert(exportJobs)
        .values({
          tenantId: ctx.tenant.id,
          createdByUserId: ctx.user.id,
          kind: 'evidence_bundle',
          status: 'queued',
          filters,
          manifest,
          artifactCount,
          rowCount,
          progressPercent: 0,
          retryCount: 0,
          maxRetries: EXPORT_JOB_MAX_RETRIES,
          expiresAt: daysFromNow(EXPORT_JOB_RETENTION_DAYS),
          retentionPolicy: {
            retention_days: EXPORT_JOB_RETENTION_DAYS,
            delete_after_expiration: true,
          },
        })
        .returning();

      await enqueueExport({ jobId: job!.id, requestId: req.id });

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.evidenceExport,
        action: AUDIT_ACTIONS.evidenceExportCreated,
        targetType: 'evidence_export_job',
        targetId: job!.id,
        payload: {
          filters,
          artifactCount,
          rowCount,
          limit,
          organizationId: targets.organization?.id ?? null,
          workspaceCount: targets.workspaces.length,
          queued: true,
        },
      });

      return reply.code(201).send({
        job: publicExportJob(job!),
        manifest,
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/audit/integrity  (tenant_admin, Enterprise only)
  //
  // Surfaces chain state for the client "Audit integrity" card: chain
  // length, last checkpoint, full re-walk verification result. Walks every
  // chain row and re-derives this_hash from the audit_events row; if any
  // row's stored this_hash diverges from the recomputed value, returns
  // verification.ok=false with the offending sequenceNum. Non-Enterprise
  // tenants get { enabled: false, reason: 'enterprise_only' }.
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/audit/integrity',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (ctx.membership.role !== 'tenant_admin') {
        throw app.httpErrors.forbidden();
      }
      if (ctx.tenant.plan !== 'enterprise') {
        return {
          enabled: false,
          reason: 'enterprise_only',
          chainLength: 0,
          lastSequenceNum: null,
          lastChainHash: null,
          checkpoints: [],
          verification: null,
        };
      }

      const chainRows = await db
        .select()
        .from(auditEventHashChain)
        .where(eq(auditEventHashChain.tenantId, ctx.tenant.id))
        .orderBy(asc(auditEventHashChain.sequenceNum));

      // Re-walk: for each chain row, fetch the audit event and recompute
      // this_hash from (prevHash, event). First divergence wins.
      let verification: { ok: boolean; mismatchAtSeq: number | null } = {
        ok: true,
        mismatchAtSeq: null,
      };
      for (const row of chainRows) {
        const [event] = await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.id, row.eventId))
          .limit(1);
        if (!event) {
          verification = { ok: false, mismatchAtSeq: row.sequenceNum };
          break;
        }
        const expected = computeChainHash(row.prevHash, event);
        if (expected !== row.thisHash) {
          verification = { ok: false, mismatchAtSeq: row.sequenceNum };
          break;
        }
      }

      const checkpoints = await db
        .select()
        .from(auditCheckpoints)
        .where(eq(auditCheckpoints.tenantId, ctx.tenant.id))
        .orderBy(desc(auditCheckpoints.lastSeq))
        .limit(10);

      return {
        enabled: true,
        chainLength: chainRows.length,
        lastSequenceNum:
          chainRows.length > 0
            ? chainRows[chainRows.length - 1]!.sequenceNum
            : null,
        lastChainHash:
          chainRows.length > 0
            ? chainRows[chainRows.length - 1]!.thisHash
            : null,
        checkpoints: checkpoints.map((c) => ({
          id: c.id,
          firstSeq: c.firstSeq,
          lastSeq: c.lastSeq,
          merkleRoot: c.merkleRoot,
          createdAt: c.createdAt.toISOString(),
        })),
        verification,
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /invitations/accept  (authenticated; email must match)
  // -----------------------------------------------------------------------
  app.post(
    '/invitations/accept',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 10, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const { token } = req.body as { token: string };
      const tokenHash = hashToken(token);

      const rows = await db
        .select()
        .from(tenantInvitations)
        .where(eq(tenantInvitations.tokenHash, tokenHash))
        .limit(1);
      const invitation = rows[0];
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt.getTime() < Date.now()
      ) {
        return reply.code(400).send({ error: 'invalid_or_expired_token' });
      }

      // Authenticated user's email must match the invited email.
      if (user.email !== invitation.email) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }

      // Already a member?
      const existing = await db
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, invitation.tenantId),
            eq(tenantMemberships.userId, user.id),
          ),
        )
        .limit(1);
      if (existing[0]) {
        // Mark invitation accepted to clean up but reject as conflict.
        await db
          .update(tenantInvitations)
          .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
          .where(eq(tenantInvitations.id, invitation.id));
        return reply.code(409).send({ error: 'already_member' });
      }

      // Create membership + mark invitation consumed atomically.
      await db.transaction(async (tx) => {
        await tx.insert(tenantMemberships).values({
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
        });
        const [org] = await tx
          .select({ organizationId: tenants.organizationId })
          .from(tenants)
          .where(eq(tenants.id, invitation.tenantId))
          .limit(1);
        if (org?.organizationId) {
          await tx
            .insert(organizationMemberships)
            .values({
              organizationId: org.organizationId,
              userId: user.id,
              orgRole:
                invitation.role === 'tenant_admin'
                  ? 'organization_admin'
                  : 'member',
              workspaceAccessMode: 'selected_workspaces',
            })
            .onConflictDoNothing();
        }
        await tx
          .update(tenantInvitations)
          .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
          .where(eq(tenantInvitations.id, invitation.id));
      });

      await writeAuditEvent(db, {
        tenantId: invitation.tenantId,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.tenantInvitationAccepted,
        targetType: 'tenant_invitation',
        targetId: invitation.id,
      });
      await writeAuditEvent(db, {
        tenantId: invitation.tenantId,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.basicAdmin,
        action: AUDIT_ACTIONS.tenantMemberAdded,
        targetType: 'user',
        targetId: user.id,
        payload: { role: invitation.role },
      });

      // Return the resulting context.
      const tenantRows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, invitation.tenantId))
        .limit(1);
      const tenant = tenantRows[0];
      if (!tenant) throw new Error('tenant disappeared mid-accept');

      reply.code(200).send({
        tenant: publicTenant(tenant),
        membership: { role: invitation.role },
      });
    },
  );

};
