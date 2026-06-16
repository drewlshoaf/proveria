import { createHash, randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import {
  apiKeys,
  tenants,
  type ApiKey,
  type DrizzleClient,
  type Tenant,
} from '@proveria/db';

const API_KEY_BYTE_LENGTH = 32;
export const API_KEY_PREFIX = 'prv_v1_';
export const API_KEY_RATE_LIMIT_LIMIT = 600;
export const API_KEY_RATE_LIMIT_WINDOW_SECONDS = 60;
const DISPLAY_PREFIX_LENGTH = 16;

export interface CreatedApiKeySecret {
  token: string;
  hash: string;
  prefix: string;
}

export interface ApiKeyPrincipal {
  key: ApiKey;
  tenant: Tenant;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentApiKey?: ApiKey;
    currentApiKeyTenant?: Tenant;
  }
}

export const generateApiKeySecret = (): CreatedApiKeySecret => {
  const token = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTE_LENGTH).toString(
    'base64url',
  )}`;
  return {
    token,
    hash: hashApiKey(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
};

export const hashApiKey = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('base64url');

export const parseBearerToken = (
  authorization: string | undefined,
): string | null => {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
};

const apiKeyUsagePath = (req: FastifyRequest): string => {
  const routeUrl = req.routeOptions.url;
  if (typeof routeUrl === 'string' && routeUrl.length > 0) return routeUrl;
  return req.url.split('?')[0] || req.url;
};

const attachApiKeyRateLimitHeaders = (reply: FastifyReply): void => {
  const resetAt = Math.ceil(Date.now() / 1000) + API_KEY_RATE_LIMIT_WINDOW_SECONDS;
  reply.header('RateLimit-Limit', String(API_KEY_RATE_LIMIT_LIMIT));
  reply.header('RateLimit-Remaining', String(API_KEY_RATE_LIMIT_LIMIT));
  reply.header('RateLimit-Reset', String(resetAt));
};

export const requireApiKeyFactory = (
  db: DrizzleClient,
  requiredScope = 'read',
): preHandlerAsyncHookHandler => {
  return async (req, reply) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      reply.code(401).send({
        error: {
          code: 'unauthorized',
          message: 'Missing Bearer API key.',
          retryable: false,
          requestId: req.id,
        },
      });
      return;
    }

    const [row] = await db
      .select({ key: apiKeys, tenant: tenants })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(
        and(
          eq(apiKeys.keyHash, hashApiKey(token)),
          isNull(apiKeys.revokedAt),
          isNull(tenants.archivedAt),
        ),
      )
      .limit(1);

    if (!row) {
      reply.code(401).send({
        error: {
          code: 'invalid_api_key',
          message: 'The API key is invalid or revoked.',
          retryable: false,
          requestId: req.id,
        },
      });
      return;
    }

    if (row.key.expiresAt && row.key.expiresAt <= new Date()) {
      reply.code(401).send({
        error: {
          code: 'invalid_api_key',
          message: 'The API key is invalid, revoked, or expired.',
          retryable: false,
          requestId: req.id,
        },
      });
      return;
    }

    attachApiKeyRateLimitHeaders(reply);

    if (!row.key.scopes.includes(requiredScope)) {
      reply.code(403).send({
        error: {
          code: 'insufficient_scope',
          message: `This API key requires the ${requiredScope} scope.`,
          retryable: false,
          requestId: req.id,
        },
      });
      return;
    }

    req.currentApiKey = row.key;
    req.currentApiKeyTenant = row.tenant;

    reply.raw.once('finish', () => {
      db.update(apiKeys)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${apiKeys.usageCount} + 1`,
          lastUsedMethod: req.method.toUpperCase(),
          lastUsedPath: apiKeyUsagePath(req),
          lastUsedStatusCode: reply.raw.statusCode,
        })
        .where(eq(apiKeys.id, row.key.id))
        .catch(() => undefined);
    });
  };
};
