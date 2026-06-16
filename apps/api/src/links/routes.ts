// Public verification-link resolver (docs/v1 §18.4).
//
// GET /v/:linkId is the URL embedded in every PDF's QR + verification text.
// It's unauthenticated: anyone with the unguessable link id sees the
// underlying signed evidence. Per §18.4:
//   • revoked / nonexistent / rotated old links → generic 404 'unavailable'
//   • expired links                              → 410 'expired' (explicit)
//   • active links                               → 200 with the package

import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import {
  attestations,
  verificationLinks,
  verificationResults,
  type DrizzleClient,
  type User,
} from '@proveria/db';
import type { ResultPackage } from '@proveria/proofs';
import type { AttestationReceipt } from '@proveria/receipt';

import { writeAuditEvent } from '../audit/writer.js';
import { requireSessionFactory } from '../auth/session-hook.js';
import { getJsonText, getObjectBytes } from '../objects/client.js';
import { enqueuePdfRendering } from '../queues/producer.js';
import { resolveTenantContext } from '../tenants/resolver.js';
import { issueVerificationLink } from './util.js';

export interface LinkPluginOptions {
  db: DrizzleClient;
}

export const linkPlugin: FastifyPluginAsync<LinkPluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;
  const requireSession = requireSessionFactory(db);

  // GET /v/:linkId.pdf — public PDF endpoint
  //
  // 200 with the cached PDF when available; 202 (pending) when not yet
  // cached (re-enqueues a render and asks the client to retry). 404/410
  // semantics match the JSON resolver. The PDF is rendered by the worker's
  // pdf-rendering job — see apps/worker/src/handlers/pdf-rendering.ts.
  const siblingKey = (objectKey: string, filename: string): string =>
    objectKey.replace(/[^/]+$/, filename);

  app.get<{ Params: { linkId: string } }>(
    '/v/:linkId.pdf',
    async (req, reply) => {
      const rows = await db
        .select()
        .from(verificationLinks)
        .where(eq(verificationLinks.id, req.params.linkId))
        .limit(1);
      const link = rows[0];
      if (!link || link.revokedAt) {
        return reply.code(404).send({ error: 'unavailable' });
      }
      if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
        return reply.code(410).send({
          error: 'expired',
          expiredAt: link.expiresAt.toISOString(),
        });
      }

      // Derive the expected PDF cache key for this target.
      let pdfKey: string;
      if (link.targetType === 'receipt') {
        const att = await db
          .select({ key: attestations.receiptJsonObjectKey })
          .from(attestations)
          .where(eq(attestations.id, link.targetRef))
          .limit(1);
        if (!att[0]?.key) {
          return reply.code(404).send({ error: 'unavailable' });
        }
        pdfKey = siblingKey(att[0].key, 'receipt.pdf');
      } else if (link.targetType === 'lookup_result') {
        const res = await db
          .select({ key: verificationResults.resultObjectKey })
          .from(verificationResults)
          .where(eq(verificationResults.packageId, link.targetRef))
          .limit(1);
        if (!res[0]?.key) {
          return reply.code(404).send({ error: 'unavailable' });
        }
        pdfKey = siblingKey(res[0].key, 'result.pdf');
      } else {
        return reply.code(404).send({ error: 'unavailable' });
      }

      const bytes = await getObjectBytes(pdfKey);
      if (bytes) {
        reply
          .code(200)
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `inline; filename="${link.id}.pdf"`,
          );
        return reply.send(bytes);
      }

      // Not cached yet — enqueue (idempotent at the job level) and ask
      // the client to retry.
      try {
        await enqueuePdfRendering({ linkId: link.id, requestId: req.id });
      } catch {
        // Redis hiccup; client will retry
      }
      return reply.code(202).send({
        status: 'pending',
        retryAfterSeconds: 3,
      });
    },
  );

  app.get<{ Params: { linkId: string } }>(
    '/v/:linkId',
    async (req, reply) => {
      const rows = await db
        .select()
        .from(verificationLinks)
        .where(eq(verificationLinks.id, req.params.linkId))
        .limit(1);
      const link = rows[0];
      // Same generic shape for missing/revoked/rotated per §18.4.
      if (!link || link.revokedAt) {
        return reply.code(404).send({ error: 'unavailable' });
      }
      if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
        return reply.code(410).send({
          error: 'expired',
          expiredAt: link.expiresAt.toISOString(),
        });
      }

      // Resolve the target.
      if (link.targetType === 'receipt') {
        const attRows = await db
          .select({
            id: attestations.id,
            receiptJsonObjectKey: attestations.receiptJsonObjectKey,
          })
          .from(attestations)
          .where(eq(attestations.id, link.targetRef))
          .limit(1);
        const att = attRows[0];
        if (!att || !att.receiptJsonObjectKey) {
          return reply.code(404).send({ error: 'unavailable' });
        }
        const receipt = JSON.parse(
          await getJsonText(att.receiptJsonObjectKey),
        ) as AttestationReceipt;
        return {
          link: {
            id: link.id,
            createdAt: link.createdAt.toISOString(),
            expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
          },
          targetType: 'receipt' as const,
          payload: receipt,
          signed: false,
          signatureValid: null,
        };
      }

      if (link.targetType === 'lookup_result') {
        const resRows = await db
          .select()
          .from(verificationResults)
          .where(eq(verificationResults.packageId, link.targetRef))
          .limit(1);
        const res = resRows[0];
        if (!res) return reply.code(404).send({ error: 'unavailable' });
        const pkg = JSON.parse(
          await getJsonText(res.resultObjectKey),
        ) as ResultPackage;
        const signed = res.signed === 'true';
        return {
          link: {
            id: link.id,
            createdAt: link.createdAt.toISOString(),
            expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
          },
          targetType: 'lookup_result' as const,
          payload: pkg,
          signed,
          signatureValid: null,
        };
      }

      return reply.code(404).send({ error: 'unavailable' });
    },
  );

  // -----------------------------------------------------------------------
  // Admin link lifecycle (docs/v1 §18.4)
  //
  // Tenant admins only. Revocation is immediate (sets revoked_at).
  // Expiration is a scheduled future deadline. Rotation issues a new link
  // pointing at the same target and revokes the old one. None of these
  // invalidate the underlying signed package.
  // -----------------------------------------------------------------------

  // Load a link by id and confirm it belongs to the slug-scoped tenant.
  // Returns null on miss; the admin only ever gets a 404 either way.
  const loadOwnedLink = async (
    tenantId: string,
    linkId: string,
  ): Promise<typeof verificationLinks.$inferSelect | undefined> => {
    const rows = await db
      .select()
      .from(verificationLinks)
      .where(
        and(
          eq(verificationLinks.id, linkId),
          eq(verificationLinks.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0];
  };

  // GET /tenants/:slug/attestations/:id/verification-links  (admin only)
  // Returns every link pointing at this attestation OR any of its lookup
  // results — the full lifecycle view for one attestation.
  app.get<{ Params: { slug: string; id: string } }>(
    '/tenants/:slug/attestations/:id/verification-links',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (ctx.membership.role !== 'tenant_admin') {
        throw app.httpErrors.forbidden();
      }
      // The attestation must belong to this tenant.
      const att = await db
        .select({ id: attestations.id })
        .from(attestations)
        .where(
          and(
            eq(attestations.id, req.params.id),
            eq(attestations.tenantId, ctx.tenant.id),
          ),
        )
        .limit(1);
      if (!att[0]) return reply.code(404).send({ error: 'not_found' });

      // Lookup-result links target package_id; collect them via the
      // verification_results rows for this attestation.
      const resultPackageIds = (
        await db
          .select({ packageId: verificationResults.packageId })
          .from(verificationResults)
          .where(eq(verificationResults.attestationId, req.params.id))
      ).map((r) => r.packageId);

      const rows = await db
        .select()
        .from(verificationLinks)
        .where(
          and(
            eq(verificationLinks.tenantId, ctx.tenant.id),
            or(
              and(
                eq(verificationLinks.targetType, 'receipt'),
                eq(verificationLinks.targetRef, req.params.id),
              ),
              resultPackageIds.length > 0
                ? and(
                    eq(verificationLinks.targetType, 'lookup_result'),
                    inArray(verificationLinks.targetRef, resultPackageIds),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(desc(verificationLinks.createdAt));

      const now = Date.now();
      return {
        links: rows.map((l) => ({
          id: l.id,
          targetType: l.targetType,
          targetRef: l.targetRef,
          createdAt: l.createdAt.toISOString(),
          expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
          revokedAt: l.revokedAt ? l.revokedAt.toISOString() : null,
          state: l.revokedAt
            ? 'revoked'
            : l.expiresAt && l.expiresAt.getTime() <= now
              ? 'expired'
              : 'active',
        })),
      };
    },
  );

  // POST /tenants/:slug/verification-links/:linkId/revoke   (admin only)
  app.post<{ Params: { slug: string; linkId: string } }>(
    '/tenants/:slug/verification-links/:linkId/revoke',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (ctx.membership.role !== 'tenant_admin') {
        throw app.httpErrors.forbidden();
      }
      const link = await loadOwnedLink(ctx.tenant.id, req.params.linkId);
      if (!link) return reply.code(404).send({ error: 'not_found' });
      if (link.revokedAt) {
        return reply.code(409).send({ error: 'already_revoked' });
      }
      const revokedAt = new Date();
      await db
        .update(verificationLinks)
        .set({ revokedAt })
        .where(eq(verificationLinks.id, link.id));
      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.verificationLinkRevoked,
        targetType: 'verification_link',
        targetId: link.id,
        payload: {
          linkId: link.id,
          targetType: link.targetType,
          targetRef: link.targetRef,
          revokedAt: revokedAt.toISOString(),
        },
      });
      reply.code(204).send();
    },
  );

  // POST /tenants/:slug/verification-links/:linkId/expire   (admin only)
  // Body: { expiresAt: ISO8601 | null }. Null clears any scheduled expiry.
  app.post<{ Params: { slug: string; linkId: string } }>(
    '/tenants/:slug/verification-links/:linkId/expire',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['expiresAt'],
          additionalProperties: false,
          properties: {
            expiresAt: {
              anyOf: [
                { type: 'string', minLength: 20, maxLength: 35 },
                { type: 'null' },
              ],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (ctx.membership.role !== 'tenant_admin') {
        throw app.httpErrors.forbidden();
      }
      const link = await loadOwnedLink(ctx.tenant.id, req.params.linkId);
      if (!link) return reply.code(404).send({ error: 'not_found' });
      if (link.revokedAt) {
        return reply.code(409).send({ error: 'already_revoked' });
      }
      const { expiresAt } = req.body as { expiresAt: string | null };
      const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
      if (expiresAtDate && Number.isNaN(expiresAtDate.getTime())) {
        return reply.code(400).send({ error: 'invalid_expires_at' });
      }
      await db
        .update(verificationLinks)
        .set({ expiresAt: expiresAtDate })
        .where(eq(verificationLinks.id, link.id));
      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.verificationLinkExpired,
        targetType: 'verification_link',
        targetId: link.id,
        payload: {
          linkId: link.id,
          targetType: link.targetType,
          targetRef: link.targetRef,
          previousExpiresAt: link.expiresAt
            ? link.expiresAt.toISOString()
            : null,
          expiresAt: expiresAtDate?.toISOString() ?? null,
        },
      });
      reply.code(200).send({
        link: {
          id: link.id,
          expiresAt: expiresAtDate ? expiresAtDate.toISOString() : null,
        },
      });
    },
  );

  // POST /tenants/:slug/verification-links/:linkId/rotate   (admin only)
  // Issues a NEW link pointing at the same target, then revokes the old one.
  // The underlying signed package is unaffected. Returns the new link id.
  app.post<{ Params: { slug: string; linkId: string } }>(
    '/tenants/:slug/verification-links/:linkId/rotate',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (ctx.membership.role !== 'tenant_admin') {
        throw app.httpErrors.forbidden();
      }
      const link = await loadOwnedLink(ctx.tenant.id, req.params.linkId);
      if (!link) return reply.code(404).send({ error: 'not_found' });
      if (link.revokedAt) {
        return reply.code(409).send({ error: 'already_revoked' });
      }

      const newLinkId = await issueVerificationLink(db, {
        tenantId: link.tenantId,
        targetType: link.targetType as 'receipt' | 'lookup_result',
        targetRef: link.targetRef,
        createdByUserId: user.id,
      });
      const revokedAt = new Date();
      await db
        .update(verificationLinks)
        .set({ revokedAt })
        .where(eq(verificationLinks.id, link.id));
      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.verificationLinkRotated,
        targetType: 'verification_link',
        targetId: link.id,
        payload: {
          linkId: link.id,
          rotatedToLinkId: newLinkId,
          targetType: link.targetType,
          targetRef: link.targetRef,
        },
      });
      reply.code(201).send({ newLinkId, verificationUrl: `/v/${newLinkId}` });
    },
  );
};
