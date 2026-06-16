// Audit hash-chain helpers (docs/v1 §19.4).
//
// PROVISIONAL — the formal audit-v1 spec amendment hasn't been written. The
// decisions below are conservative and documented so the external review can
// either ratify them or amend.
//
// One row per audit_event for Enterprise tenants. Each row's this_hash is
// SHA-256(prev_hash || canonical(event)), where canonical(event) is the
// RFC 8785 canonical bytes of a fixed-shape JSON view of the row. The first
// row per tenant uses prev_hash = 32 zero bytes. Together with the per-
// tenant monotonic sequence number this gives tamper-evident append-only
// audit: any post-hoc mutation of an event breaks the chain from that point
// forward, and an integrity check re-walks + recomputes to verify.

import { createHash } from 'node:crypto';

import { canonicalize } from '@proveria/crypto-core';
import {
  auditEventHashChain,
  auditEvents,
  tenants,
  type AuditEvent,
  type DrizzleClient,
} from '@proveria/db';
import { desc, eq, sql } from 'drizzle-orm';

/** 32 zero bytes hex — chain genesis prev_hash. */
export const CHAIN_GENESIS_HEX =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Build the canonical JSON view of an audit event for hash-chaining. Order
 * + types of fields are fixed; RFC 8785 then sorts keys + serializes.
 * Verifiers MUST use the same shape.
 */
export const canonicalAuditEventBytes = (event: AuditEvent): Uint8Array =>
  canonicalize({
    id: event.id,
    tenant_id: event.tenantId,
    actor_user_id: event.actorUserId,
    actor_device_id: event.actorDeviceId,
    category: event.category,
    action: event.action,
    target_type: event.targetType,
    target_id: event.targetId,
    payload: event.payload,
    created_at: event.createdAt.toISOString(),
  });

const fromHex = (h: string): Buffer => Buffer.from(h, 'hex');
const toHex = (b: Uint8Array | Buffer): string =>
  Buffer.from(b).toString('hex');

/** Compute this_hash = SHA-256(prev_hash || canonical(event)). */
export const computeChainHash = (
  prevHashHex: string,
  event: AuditEvent,
): string =>
  toHex(
    createHash('sha256')
      .update(fromHex(prevHashHex))
      .update(canonicalAuditEventBytes(event))
      .digest(),
  );

/**
 * If the audit event's tenant is on the Enterprise plan, append the
 * corresponding chain row. Held under a per-tenant Postgres advisory lock to
 * serialize sequence allocation. Idempotent at the (tenant_id, sequence_num)
 * unique-index level — a duplicate attempt would error and be retried by
 * the caller.
 *
 * Safe to call from inside or outside a caller's transaction (uses a nested
 * transaction).
 */
export const appendChainEntryIfEnterprise = async (
  db: DrizzleClient,
  event: AuditEvent,
): Promise<void> => {
  if (!event.tenantId) return; // system events without a tenant aren't chained
  const planRows = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, event.tenantId))
    .limit(1);
  if (planRows[0]?.plan !== 'enterprise') return;

  await db.transaction(async (tx) => {
    // Serialize chain writes for this tenant. The hash() ensures the lock id
    // fits in postgres's int8.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${'audit-chain-' + event.tenantId}, 0))`,
    );

    const [latest] = await tx
      .select({
        sequenceNum: auditEventHashChain.sequenceNum,
        thisHash: auditEventHashChain.thisHash,
      })
      .from(auditEventHashChain)
      .where(eq(auditEventHashChain.tenantId, event.tenantId!))
      .orderBy(desc(auditEventHashChain.sequenceNum))
      .limit(1);

    const prevHash = latest?.thisHash ?? CHAIN_GENESIS_HEX;
    const sequenceNum = (latest?.sequenceNum ?? 0) + 1;
    const thisHash = computeChainHash(prevHash, event);

    await tx.insert(auditEventHashChain).values({
      tenantId: event.tenantId!,
      eventId: event.id,
      sequenceNum,
      prevHash,
      thisHash,
    });
  });
};

/**
 * Insert an audit event AND append the chain row if the tenant is
 * Enterprise. Returns the inserted event. The chain append is best-effort
 * within the same scope — if it throws (e.g. concurrency loss to the unique
 * index), the audit event still landed; the caller can re-run integrity to
 * detect/repair.
 */
export interface WriteAuditEventInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorDeviceId?: string | null;
  category: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}

export const writeAuditEvent = async (
  db: DrizzleClient,
  input: WriteAuditEventInput,
): Promise<AuditEvent> => {
  const [event] = await db
    .insert(auditEvents)
    .values({
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorDeviceId: input.actorDeviceId ?? null,
      category: input.category,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payload: input.payload ?? {},
    })
    .returning();
  if (!event) throw new Error('audit_event insert returned no row');
  await appendChainEntryIfEnterprise(db, event);
  return event;
};
