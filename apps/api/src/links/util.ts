// Verification link issuance + resolution helpers (docs/v1 §18.4).
//
// A link is the shareable URL token embedded in a PDF's QR + verification
// URL. The same helper runs in the api (for lookup-result links, issued
// inline) and the worker (for receipt links, issued at receipt generation).

import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  verificationLinks,
  type DrizzleClient,
} from '@proveria/db';

export type VerificationLinkTargetType = 'receipt' | 'lookup_result';

export const newLinkId = (): string =>
  `vrf_${randomBytes(12).toString('hex')}`;

export interface IssueVerificationLinkInput {
  tenantId: string;
  targetType: VerificationLinkTargetType;
  /** attestation_id for 'receipt'; package_id for 'lookup_result'. */
  targetRef: string;
  createdByUserId?: string | null;
}

/**
 * Insert a new active link for the given target. Returns the link id. We
 * always insert a new row rather than dedupe — issuing a fresh link for the
 * same target is intentional (the new one is the current canonical link;
 * old ones can be revoked separately if needed).
 */
export const issueVerificationLink = async (
  db: DrizzleClient,
  input: IssueVerificationLinkInput,
): Promise<string> => {
  const id = newLinkId();
  await db.insert(verificationLinks).values({
    id,
    tenantId: input.tenantId,
    targetType: input.targetType,
    targetRef: input.targetRef,
    createdByUserId: input.createdByUserId ?? null,
  });
  return id;
};

/**
 * Find the most recent ACTIVE (not revoked, not expired) link for a given
 * target. Used by PDF rendering to embed the canonical verification URL.
 */
export const findActiveLinkForTarget = async (
  db: DrizzleClient,
  targetType: VerificationLinkTargetType,
  targetRef: string,
): Promise<string | null> => {
  const rows = await db
    .select({ id: verificationLinks.id, expiresAt: verificationLinks.expiresAt })
    .from(verificationLinks)
    .where(
      and(
        eq(verificationLinks.targetType, targetType),
        eq(verificationLinks.targetRef, targetRef),
        isNull(verificationLinks.revokedAt),
      ),
    );
  const now = Date.now();
  const active = rows.find(
    (r) => !r.expiresAt || r.expiresAt.getTime() > now,
  );
  return active ? active.id : null;
};
