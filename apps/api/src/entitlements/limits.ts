// Plan-limit enforcement helpers (docs/v1 §22 — Entitlements).
//
// The PLAN_LIMITS table in @proveria/shared-types is the source of truth
// for what each tier can do; this module wraps the COUNT queries plus the
// "would this push us over the cap" check that route handlers call before
// committing a write.
//
// All helpers return { ok: true } on permission OR { ok: false, error,
// limit, current } on rejection. Routes serialize the error verbatim so
// clients can show the cap inline.

import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  PLAN_LIMITS,
  type PlanLimits,
  type PlanSlug,
} from '@proveria/shared-types';
import {
  attestations,
  projects,
  submissionAttempts,
  tenantMemberships,
  type DrizzleClient,
} from '@proveria/db';

export interface LimitDeny {
  ok: false;
  error: string;
  limit: number;
  current: number;
}
export interface LimitAllow {
  ok: true;
}
export type LimitResult = LimitAllow | LimitDeny;

const ALLOW: LimitAllow = { ok: true };

const limitsFor = (plan: string): PlanLimits =>
  (PLAN_LIMITS as Record<string, PlanLimits>)[plan] ?? PLAN_LIMITS.free;

/**
 * Project count cap (docs/v1 §22.2). Free is 5; paid tiers are uncapped.
 * Counts ALL projects in the tenant including archived — archived still
 * holds the slug namespace and the underlying evidence.
 */
export const checkProjectCountLimit = async (
  db: DrizzleClient,
  tenantId: string,
  plan: string,
): Promise<LimitResult> => {
  const limit = limitsFor(plan).projects;
  if (limit === null) return ALLOW;
  const [row] = await db
    .select({ n: count() })
    .from(projects)
    .where(eq(projects.tenantId, tenantId));
  const current = Number(row?.n ?? 0);
  if (current >= limit) {
    return {
      ok: false,
      error: 'project_count_limit_reached',
      limit,
      current,
    };
  }
  return ALLOW;
};

/**
 * Per-project attestation cap (§22.2 Free: 1/project; null for paid tiers).
 * Counts ALL attestations in the project regardless of state — failed +
 * canceled still occupy the "slot" because repair under the existing
 * attestation_id is the supported retry path (§11.4).
 */
export const checkAttestationsPerProjectLimit = async (
  db: DrizzleClient,
  projectId: string,
  plan: string,
): Promise<LimitResult> => {
  const limit = limitsFor(plan).attestationsPerProject;
  if (limit === null) return ALLOW;
  const [row] = await db
    .select({ n: count() })
    .from(attestations)
    .where(eq(attestations.projectId, projectId));
  const current = Number(row?.n ?? 0);
  if (current >= limit) {
    return {
      ok: false,
      error: 'attestations_per_project_limit_reached',
      limit,
      current,
    };
  }
  return ALLOW;
};

/**
 * Monthly attestation allowance (Team Starter 50, Team Pro 500). Counts
 * attestations created in the current UTC calendar month — resets at
 * 00:00 UTC on the 1st. Free is null (dominated by per-project cap);
 * Enterprise is null (custom, out-of-band).
 */
export const checkMonthlyAttestationLimit = async (
  db: DrizzleClient,
  tenantId: string,
  plan: string,
  now: Date = new Date(),
): Promise<LimitResult> => {
  const limit = limitsFor(plan).attestationsPerMonth;
  if (limit === null) return ALLOW;
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const [row] = await db
    .select({ n: count() })
    .from(attestations)
    .where(
      and(
        eq(attestations.tenantId, tenantId),
        gte(attestations.createdAt, monthStart),
      ),
    );
  const current = Number(row?.n ?? 0);
  if (current >= limit) {
    return {
      ok: false,
      error: 'monthly_attestation_limit_reached',
      limit,
      current,
    };
  }
  return ALLOW;
};

/**
 * Cumulative retained-storage cap (bytes). Defined as the sum of
 * confirmed attestation byte_size across all confirmed attempts under
 * the tenant. We charge against confirmed evidence only — pre-confirmed
 * attempts don't count toward storage until they confirm (failed
 * attempts retain artifacts but those expire per §22.3 retention).
 *
 * Storage is computed by summing leaf.metadata.byte_size where leaf_type
 * is 'file/sha256/v1' across the tenant's confirmed manifests. That's an
 * expensive joins, so V1 uses a cheap upper-bound proxy: number of
 * confirmed attestations × the size of THIS submission's whole-file
 * leaves. Real "storage observed" tracking is a §15 deferrable.
 *
 * For C49 we just bound at submission time: sum byte_size of THIS
 * manifest's file leaves and reject if (currentBytes + thisSubmission)
 * would exceed the cap. currentBytes is approximated by summing
 * byte_size across all uploaded+ attempts in the tenant.
 */
export const checkStorageLimit = async (
  db: DrizzleClient,
  tenantId: string,
  plan: string,
  incomingBytes: number,
): Promise<LimitResult> => {
  const limit = limitsFor(plan).storageBytes;
  if (limit === null) return ALLOW;
  // Sum byte_size across all uploaded-or-better attempts for the tenant.
  // We can't easily walk each manifest's leaf_set in SQL; instead we
  // count attestations × a synthetic per-attestation overhead. For V1
  // accuracy, accept that this is a coarse estimate: every attestation
  // counts as some bytes derived from the most recent attempt's known
  // submission_attempts.byte_total column if present, else 0.
  //
  // Schema doesn't carry submission_attempts.byte_total yet; until it
  // does we approximate "current" as ZERO and only enforce against the
  // incoming size. This still catches the >> cap case (e.g. uploading
  // a 30 GB manifest on a 25 GB Team Starter plan) while leaving room
  // for a follow-up checkpoint to add real cumulative accounting.
  const current = 0;
  if (incomingBytes > limit) {
    return {
      ok: false,
      error: 'storage_limit_exceeded',
      limit,
      current: incomingBytes,
    };
  }
  return ALLOW;
};

/**
 * User-count cap (§22.2 Users column). Counts active tenant memberships.
 * Invited-but-not-accepted invitations do NOT count yet — they only flip
 * into a membership when the invitee accepts.
 */
export const checkUserCountLimit = async (
  db: DrizzleClient,
  tenantId: string,
  plan: string,
): Promise<LimitResult> => {
  const limit = limitsFor(plan).users;
  if (limit === null) return ALLOW;
  const [row] = await db
    .select({ n: count() })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.tenantId, tenantId));
  const current = Number(row?.n ?? 0);
  if (current >= limit) {
    return {
      ok: false,
      error: 'user_count_limit_reached',
      limit,
      current,
    };
  }
  return ALLOW;
};

// Re-export for routes that just want to look the table up directly.
export { PLAN_LIMITS, limitsFor };

// Used by the storage check to keep the "submission" math next to the cap
// check itself; in C49 the route helper passes raw bytes in directly.
// `submissionAttempts` + `sql` imports are kept so future expansion into
// real cumulative-storage accounting doesn't need an import dance.
void submissionAttempts;
void sql;
void isNull;
