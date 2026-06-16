import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '@proveria/audit';
import {
  apiKeys,
  type ApiKey,
  type DrizzleClient,
  type Role,
  type Tenant,
  type User,
} from '@proveria/db';

import { writeAuditEvent } from '../audit/writer.js';
import { generateApiKeySecret } from '../auth/api-keys.js';
import { requireSessionFactory } from '../auth/session-hook.js';
import { resolveTenantContext } from '../tenants/resolver.js';

export interface ApiKeyPluginOptions {
  db: DrizzleClient;
}

const ALLOWED_SCOPES = ['read', 'write'] as const;
type ApiScope = (typeof ALLOWED_SCOPES)[number];

const normalizeScopes = (input: unknown): ApiScope[] | null => {
  if (input === undefined) return ['read'];
  if (!Array.isArray(input) || input.length === 0) return null;
  const deduped = [...new Set(input)];
  if (
    deduped.some(
      (scope) => typeof scope !== 'string' || !ALLOWED_SCOPES.includes(scope as ApiScope),
    )
  ) {
    return null;
  }
  return deduped as ApiScope[];
};

const publicApiKey = (
  key: ApiKey,
  workspace: Tenant,
): {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  workspace: { id: string; slug: string; name: string };
  createdByUserId: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  lastUsedMethod: string | null;
  lastUsedPath: string | null;
  lastUsedStatusCode: number | null;
  revokedAt: string | null;
} => ({
  id: key.id,
  name: key.name,
  keyPrefix: key.keyPrefix,
  scopes: key.scopes,
  workspace: {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
  },
  createdByUserId: key.createdByUserId,
  createdAt: key.createdAt.toISOString(),
  expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
  lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
  usageCount: key.usageCount,
  lastUsedMethod: key.lastUsedMethod,
  lastUsedPath: key.lastUsedPath,
  lastUsedStatusCode: key.lastUsedStatusCode,
  revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
});

const ensureTenantAdmin = (
  app: import('fastify').FastifyInstance,
  role: Role,
): void => {
  if (role !== 'tenant_admin') throw app.httpErrors.forbidden();
};

export const apiKeyPlugin: FastifyPluginAsync<ApiKeyPluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;
  const requireSession = requireSessionFactory(db);

  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/api-keys',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureTenantAdmin(app, ctx.membership.role);

      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.tenantId, ctx.tenant.id))
        .orderBy(desc(apiKeys.createdAt));

      return { apiKeys: rows.map((key) => publicApiKey(key, ctx.tenant)) };
    },
  );

  app.post<{ Params: { slug: string } }>(
    '/tenants/:slug/api-keys',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            scopes: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', enum: ALLOWED_SCOPES as unknown as string[] },
            },
            expiresAt: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureTenantAdmin(app, ctx.membership.role);

      const body = req.body as {
        name: string;
        scopes?: unknown;
        expiresAt?: string;
      };
      const name = body.name.trim();
      if (!name) return reply.code(400).send({ error: 'invalid_name' });
      const scopes = normalizeScopes(body.scopes);
      if (!scopes) return reply.code(400).send({ error: 'invalid_scope' });
      const expiresAt =
        body.expiresAt === undefined ? null : new Date(body.expiresAt);
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return reply.code(400).send({ error: 'invalid_expires_at' });
      }
      if (expiresAt && expiresAt <= new Date()) {
        return reply.code(400).send({ error: 'invalid_expires_at' });
      }

      const secret = generateApiKeySecret();
      const [inserted] = await db
        .insert(apiKeys)
        .values({
          tenantId: ctx.tenant.id,
          name,
          keyPrefix: secret.prefix,
          keyHash: secret.hash,
          scopes,
          expiresAt,
          createdByUserId: user.id,
        })
        .returning();
      if (!inserted) throw app.httpErrors.internalServerError();

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.apiSdkWebhook,
        action: AUDIT_ACTIONS.apiKeyCreated,
        targetType: 'api_key',
        targetId: inserted.id,
        payload: {
          name,
          scopes,
          keyPrefix: secret.prefix,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
        },
      });

      reply.code(201);
      return { apiKey: publicApiKey(inserted, ctx.tenant), token: secret.token };
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/tenants/:slug/api-keys/:id',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureTenantAdmin(app, ctx.membership.role);

      const [updated] = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, req.params.id),
            eq(apiKeys.tenantId, ctx.tenant.id),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning();

      if (!updated) return reply.code(404).send({ error: 'not_found' });

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.apiSdkWebhook,
        action: AUDIT_ACTIONS.apiKeyRevoked,
        targetType: 'api_key',
        targetId: updated.id,
        payload: { name: updated.name, keyPrefix: updated.keyPrefix },
      });

      reply.code(204);
      return undefined;
    },
  );
};
