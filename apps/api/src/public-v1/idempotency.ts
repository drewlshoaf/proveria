import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { idempotencyKeys, type ApiKey, type DrizzleClient } from '@proveria/db';

export interface IdempotencyReplay {
  statusCode: number;
  responseBody: unknown;
}

export const requestHash = (body: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null), 'utf8')
    .digest('base64url');

export const idempotencyHeader = (
  headers: import('fastify').FastifyRequest['headers'],
): string | null => {
  const value = headers['idempotency-key'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const findReplay = async (
  db: DrizzleClient,
  input: {
    tenantId: string;
    apiKeyId: string;
    method: string;
    path: string;
    key: string;
    requestHash: string;
  },
): Promise<IdempotencyReplay | 'conflict' | null> => {
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.tenantId, input.tenantId),
        eq(idempotencyKeys.apiKeyId, input.apiKeyId),
        eq(idempotencyKeys.method, input.method),
        eq(idempotencyKeys.path, input.path),
        eq(idempotencyKeys.key, input.key),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.requestHash !== input.requestHash) return 'conflict';
  return { statusCode: row.statusCode, responseBody: row.responseBody };
};

export const storeReplay = async (
  db: DrizzleClient,
  input: {
    tenantId: string;
    apiKey: ApiKey;
    method: string;
    path: string;
    key: string;
    requestHash: string;
    statusCode: number;
    responseBody: unknown;
  },
): Promise<void> => {
  await db.insert(idempotencyKeys).values({
    tenantId: input.tenantId,
    apiKeyId: input.apiKey.id,
    key: input.key,
    method: input.method,
    path: input.path,
    requestHash: input.requestHash,
    statusCode: input.statusCode,
    responseBody: input.responseBody,
  });
};
