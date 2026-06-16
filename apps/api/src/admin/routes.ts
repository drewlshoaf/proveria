// Platform-admin surface — read-only inspection of the BullMQ queue health
// and recently-failed jobs. Gated behind config.platformAdminEmails so
// only the env-var allowlist can hit it (V1 has no platform-admin role).
//
// docs/v1 §25.2 calls for a "minimal read-only internal support/admin
// view"; this is the queue half (the full tenant-inventory admin view is
// deferred along with the rest of the AWS-deploy cut from M15).

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { FastifyPluginAsync } from 'fastify';

import {
  attestations,
  submissionAttempts,
  type DrizzleClient,
  type User,
} from '@proveria/db';
import { and, desc, eq } from 'drizzle-orm';

import { requireSessionFactory } from '../auth/session-hook.js';
import { config } from '../config.js';

const QUEUE_NAMES = [
  'attestation-validation',
  'receipt-generation',
  'proof-package-generation',
  'pdf-rendering',
  'audit-events',
  'object-finalization',
] as const;
type QueueName = (typeof QUEUE_NAMES)[number];
const isQueueName = (s: string): s is QueueName =>
  (QUEUE_NAMES as readonly string[]).includes(s);

export interface AdminPluginOptions {
  db: DrizzleClient;
  /** Optional — when null, queue-health endpoints return 503. */
  redis: Redis | null;
}

const isPlatformAdmin = (user: User): boolean =>
  config.platformAdminEmails.includes(user.email.toLowerCase());

export const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (
  app,
  opts,
) => {
  const { db, redis } = opts;
  const requireSession = requireSessionFactory(db);

  const queues = new Map<QueueName, Queue>();
  const getQueue = (name: QueueName): Queue => {
    if (!redis) throw new Error('no redis connection');
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: redis });
      queues.set(name, q);
    }
    return q;
  };

  app.addHook('onClose', async () => {
    await Promise.all([...queues.values()].map((q) => q.close()));
  });

  // -----------------------------------------------------------------------
  // GET /admin/queues  (platform admin)
  //
  // Per-queue counts across the standard BullMQ buckets. Useful for the
  // operator answering "is anything stuck?" without grep'ing logs.
  // -----------------------------------------------------------------------
  app.get('/admin/queues', { preHandler: requireSession }, async (req, reply) => {
    const user = req.currentUser as User;
    if (!isPlatformAdmin(user)) return reply.code(403).send({ error: 'forbidden' });
    if (!redis) return reply.code(503).send({ error: 'no_redis' });

    const queueCounts = await Promise.all(
      QUEUE_NAMES.map(async (name) => {
        try {
          const q = getQueue(name);
          const counts = await q.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          );
          return { name, counts };
        } catch (err) {
          return { name, error: (err as Error).message };
        }
      }),
    );
    return { queues: queueCounts };
  });

  // -----------------------------------------------------------------------
  // GET /admin/queues/:name/failed  (platform admin)
  //
  // Recently-failed jobs for one queue, newest-first. Includes payload
  // (so the admin can see which attestation_id / link_id failed), the
  // failure reason, and the carried-through request_id when present.
  // -----------------------------------------------------------------------
  app.get<{ Params: { name: string }; Querystring: { limit?: string } }>(
    '/admin/queues/:name/failed',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      if (!isPlatformAdmin(user))
        return reply.code(403).send({ error: 'forbidden' });
      if (!redis) return reply.code(503).send({ error: 'no_redis' });
      if (!isQueueName(req.params.name))
        return reply.code(404).send({ error: 'unknown_queue' });

      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
      const q = getQueue(req.params.name);
      const jobs = await q.getFailed(0, limit - 1);
      return {
        queue: req.params.name,
        failed: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          attemptsMade: j.attemptsMade,
          failedReason: j.failedReason,
          stacktrace: j.stacktrace?.slice(0, 3) ?? [],
          requestId:
            (j.data as { requestId?: string } | undefined)?.requestId ?? null,
          data: j.data,
          timestamp: j.timestamp,
          finishedOn: j.finishedOn ?? null,
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /admin/attestations/failed  (platform admin)
  //
  // Cross-tenant listing of attestations stuck in failed_needs_review so
  // operators can see at-a-glance what producers are hitting + drive
  // outreach. Includes the last attempt's validation_error.
  // -----------------------------------------------------------------------
  app.get<{ Querystring: { limit?: string } }>(
    '/admin/attestations/failed',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      if (!isPlatformAdmin(user))
        return reply.code(403).send({ error: 'forbidden' });
      const limit = Math.min(
        100,
        Math.max(1, Number(req.query.limit ?? 25)),
      );
      const rows = await db
        .select({
          id: attestations.id,
          tenantId: attestations.tenantId,
          projectId: attestations.projectId,
          label: attestations.label,
          state: attestations.state,
          createdAt: attestations.createdAt,
          failedAt: attestations.failedAt,
        })
        .from(attestations)
        .where(eq(attestations.state, 'failed_needs_review'))
        .orderBy(desc(attestations.failedAt))
        .limit(limit);
      // For each, fetch the most recent failed attempt to surface the
      // validation_error (the actionable bit).
      const enriched = await Promise.all(
        rows.map(async (r) => {
          const [last] = await db
            .select({
              id: submissionAttempts.id,
              state: submissionAttempts.state,
              validationError: submissionAttempts.validationError,
              failedAt: submissionAttempts.failedAt,
            })
            .from(submissionAttempts)
            .where(
              and(
                eq(submissionAttempts.attestationId, r.id),
                eq(submissionAttempts.state, 'failed'),
              ),
            )
            .orderBy(desc(submissionAttempts.failedAt))
            .limit(1);
          return {
            ...r,
            createdAt: r.createdAt.toISOString(),
            failedAt: r.failedAt ? r.failedAt.toISOString() : null,
            lastFailedAttempt: last
              ? {
                  id: last.id,
                  validationError: last.validationError,
                  failedAt: last.failedAt
                    ? last.failedAt.toISOString()
                    : null,
                }
              : null,
          };
        }),
      );
      return { attestations: enriched };
    },
  );
};
