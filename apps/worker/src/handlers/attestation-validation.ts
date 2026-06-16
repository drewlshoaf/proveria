// Real attestation validation (M4/C14, artifact-hardened M5/C16).
//
// For an attempt in state 'uploaded' with a manifest object key:
//   1. fetch + parse the manifest from object storage
//   2. validateManifest() — structural checks + the two trust-spine recomputes
//      (every leaf_hash re-derived from its payload hash; merkle_root
//      recomputed from the leaf set)
//   3. cross-check the manifest's tenant/project/attestation/attempt ids
//      against the actual rows — a manifest claiming to be for a different
//      attestation is rejected
//   4. verify the signer. Desktop attestations resolve the paired device's
//      stored Ed25519 public key; public API attestations use Proveria's
//      platform key and have no desktop device row.
//
// Every attempt — confirmed or failed — gets a validation-result.json written
// to its immutable prefix (docs/v1 §7.3) so failed attempts retain evidence.
// A confirmed attempt additionally gets leaves.jsonl, and the attestation row
// is pointed at the canonical confirmed artifacts.
//
// Only when all five checks pass: attempt → 'validated', attestation →
// 'confirmed', confirmed_attempt_id + merkle_root + artifact keys set, audit
// rows written. Any failure: attempt → 'failed', attestation →
// 'failed_needs_review', error captured.

import { and, eq, isNull } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  writeAuditEvent,
} from '@proveria/audit';
import {
  attestations,
  devices,
  submissionAttempts,
  tenants,
  type DrizzleClient,
} from '@proveria/db';
import {
  validateManifest,
  verifyManifestSignature,
  type Manifest,
} from '@proveria/manifest';

import { createWebhookDeliveries } from './webhook-events.js';

export interface ValidationResult {
  ok: boolean;
  state: 'validated' | 'failed';
  error?: string;
}

export type PutObject = (
  objectKey: string,
  body: string | Buffer | Uint8Array,
  contentType: string,
) => Promise<void>;

export interface ValidateAttemptDeps {
  db: DrizzleClient;
  fetchManifest: (objectKey: string) => Promise<string>;
  putObject: PutObject;
  enqueueWebhookDelivery?: (deliveryId: string) => Promise<void>;
}

const RESULT_VERSION = '1.0';

/** Derive a sibling artifact key inside the same immutable attempt prefix. */
const siblingKey = (manifestObjectKey: string, filename: string): string =>
  manifestObjectKey.replace(/[^/]+$/, filename);

/** leaves.jsonl — one canonical leaf entry per line (docs/v1 §7.3). */
const leavesJsonl = (manifest: Manifest): string =>
  manifest.leaf_set.map((leaf) => JSON.stringify(leaf)).join('\n') + '\n';

interface ValidationResultDoc {
  result_version: string;
  attestation_id: string;
  attempt_id: string;
  manifest_object_key: string;
  outcome: 'validated' | 'failed';
  merkle_root: string | null;
  error: string | null;
  completed_at: string;
}

const validationResultJson = (doc: ValidationResultDoc): string =>
  JSON.stringify(doc, null, 2);

export const validateAttempt = async (
  deps: ValidateAttemptDeps,
  attemptId: string,
): Promise<ValidationResult> => {
  const { db, fetchManifest } = deps;

  const attemptRows = await db
    .select()
    .from(submissionAttempts)
    .where(eq(submissionAttempts.id, attemptId))
    .limit(1);
  const attempt = attemptRows[0];
  if (!attempt) {
    return { ok: false, state: 'failed', error: 'attempt_not_found' };
  }
  if (attempt.state !== 'uploaded') {
    return {
      ok: false,
      state: 'failed',
      error: `attempt_not_in_uploaded_state:${attempt.state}`,
    };
  }
  if (!attempt.manifestObjectKey) {
    return {
      ok: false,
      state: 'failed',
      error: 'attempt_missing_manifest_key',
    };
  }
  const manifestObjectKey = attempt.manifestObjectKey;

  const attestationRows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.id, attempt.attestationId))
    .limit(1);
  const attestation = attestationRows[0];
  if (!attestation) {
    return { ok: false, state: 'failed', error: 'attestation_not_found' };
  }

  // --- 1. fetch + parse ---------------------------------------------------
  let manifestText: string;
  try {
    manifestText = await fetchManifest(manifestObjectKey);
  } catch (err) {
    return fail(
      deps,
      attestation,
      attemptId,
      manifestObjectKey,
      `manifest_fetch_failed:${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (err) {
    return fail(
      deps,
      attestation,
      attemptId,
      manifestObjectKey,
      `manifest_json_invalid:${(err as Error).message}`,
    );
  }

  // --- 2. structural + cryptographic recompute ---------------------------
  const structural = validateManifest(parsed);
  if (!structural.valid) {
    const summary = structural.issues
      .map((i) => `${i.field}:${i.message}`)
      .join('; ');
    return fail(
      deps,
      attestation,
      attemptId,
      manifestObjectKey,
      `manifest_invalid:${summary}`,
    );
  }
  const manifest = parsed as Manifest;

  // --- 3. cross-check manifest ids against the rows ----------------------
  const idChecks: Array<[string, string, string]> = [
    ['attestation_id', manifest.attestation_id, attestation.id],
    ['attempt_id', manifest.attempt_id, attempt.id],
    ['tenant_id', manifest.tenant_id, attestation.tenantId],
    ['project_id', manifest.project_id, attestation.projectId],
    [
      'created_by_user_id',
      manifest.created_by_user_id,
      attestation.createdByUserId,
    ],
  ];
  for (const [field, claimed, actual] of idChecks) {
    if (claimed !== actual) {
      return fail(
        deps,
        attestation,
        attemptId,
        manifestObjectKey,
        `manifest_${field}_mismatch:claimed=${claimed},actual=${actual}`,
      );
    }
  }

  // --- 3b. plan-gate shingling: Free tenants MUST NOT submit shingle leaves
  // (docs/protocol/v1/shingling-v1.md §2; docs/v1 §22.2 plan table).
  const hasShingleLeaves = manifest.leaf_set.some(
    (l) => l.leaf_type === 'shingle/sha256/v1',
  );
  if (hasShingleLeaves) {
    const [tenantRow] = await db
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, attestation.tenantId))
      .limit(1);
    if (tenantRow?.plan === 'free') {
      return fail(
        deps,
        attestation,
        attemptId,
        manifestObjectKey,
        'shingling_not_in_plan:free',
      );
    }
  }

  let actorDeviceId: string | undefined;
  if (attestation.createdByDeviceId) {
    if (manifest.created_by_device_id !== attestation.createdByDeviceId) {
      return fail(
        deps,
        attestation,
        attemptId,
        manifestObjectKey,
        `manifest_created_by_device_id_mismatch:claimed=${manifest.created_by_device_id},actual=${attestation.createdByDeviceId}`,
      );
    }

    const deviceRows = await db
      .select()
      .from(devices)
      .where(eq(devices.id, manifest.created_by_device_id))
      .limit(1);
    const device = deviceRows[0];
    if (!device) {
      return fail(
        deps,
        attestation,
        attemptId,
        manifestObjectKey,
        'device_not_found',
      );
    }
    if (device.revokedAt) {
      return fail(
        deps,
        attestation,
        attemptId,
        manifestObjectKey,
        'device_revoked',
      );
    }

    const signatureOk = await verifyManifestSignature(
      manifest,
      'device',
      device.publicKey,
      device.id,
    );
    if (!signatureOk) {
      return fail(
        deps,
        attestation,
        attemptId,
        manifestObjectKey,
        'device_signature_invalid',
      );
    }
    actorDeviceId = device.id;
  } else {
    // API-submitted attestations are authenticated at request time by API key.
    // Proveria no longer acts as an attestor by adding a platform signature to
    // the manifest.
  }

  // --- all checks passed: write artifacts, then confirm ------------------
  const now = new Date();
  const leavesObjectKey = siblingKey(manifestObjectKey, 'leaves.jsonl');
  const validationResultObjectKey = siblingKey(
    manifestObjectKey,
    'validation-result.json',
  );
  await deps.putObject(
    leavesObjectKey,
    leavesJsonl(manifest),
    'application/x-ndjson',
  );
  await deps.putObject(
    validationResultObjectKey,
    validationResultJson({
      result_version: RESULT_VERSION,
      attestation_id: attestation.id,
      attempt_id: attemptId,
      manifest_object_key: manifestObjectKey,
      outcome: 'validated',
      merkle_root: manifest.merkle_root,
      error: null,
      completed_at: now.toISOString(),
    }),
    'application/json',
  );

  await db.transaction(async (tx) => {
    await tx
      .update(submissionAttempts)
      .set({
        state: 'validated',
        validatedAt: now,
        updatedAt: now,
        leavesObjectKey,
        validationResultObjectKey,
      })
      .where(eq(submissionAttempts.id, attemptId));
    await tx
      .update(attestations)
      .set({
        state: 'confirmed',
        confirmedAttemptId: attemptId,
        confirmedAt: now,
        updatedAt: now,
        manifestObjectKey,
        leavesObjectKey,
        merkleRoot: manifest.merkle_root,
      })
      .where(
        and(
          eq(attestations.id, attestation.id),
          isNull(attestations.confirmedAt),
        ),
      );
  });

  // Audit events written outside the state-change transaction. They go
  // through @proveria/audit's writeAuditEvent so Enterprise tenants get the
  // hash-chain entries (docs/v1 §19.4). Slight loss of atomicity (state
  // commits before audit) is acceptable — the audit row is observational.
  await writeAuditEvent(db, {
    tenantId: attestation.tenantId,
    actorDeviceId,
    category: AUDIT_CATEGORIES.attestationLifecycle,
    action: AUDIT_ACTIONS.attestationValidated,
    targetType: 'submission_attempt',
    targetId: attemptId,
  });
  await writeAuditEvent(db, {
    tenantId: attestation.tenantId,
    actorDeviceId,
    category: AUDIT_CATEGORIES.attestationLifecycle,
    action: AUDIT_ACTIONS.attestationConfirmed,
    targetType: 'attestation',
    targetId: attestation.id,
    payload: { merkleRoot: manifest.merkle_root },
  });

  const webhookDeliveries = await createWebhookDeliveries(db, {
    tenantId: attestation.tenantId,
    eventType: 'attestation.confirmed',
    occurredAt: now,
    data: {
      attestationId: attestation.id,
      attemptId,
      merkleRoot: manifest.merkle_root,
    },
  });
  if (deps.enqueueWebhookDelivery) {
    await Promise.all(
      webhookDeliveries.map((delivery) =>
        deps.enqueueWebhookDelivery!(delivery.id),
      ),
    );
  }

  return { ok: true, state: 'validated' };
};

const fail = async (
  deps: ValidateAttemptDeps,
  attestation: typeof attestations.$inferSelect,
  attemptId: string,
  manifestObjectKey: string,
  error: string,
): Promise<ValidationResult> => {
  const { db } = deps;
  const now = new Date();
  // Failed attempts retain a validation-result.json for auditability and
  // repair history (docs/v1 §7.3 / §11.4). Best-effort: a write failure here
  // must not mask the underlying validation error.
  const validationResultObjectKey = siblingKey(
    manifestObjectKey,
    'validation-result.json',
  );
  let resultKeyWritten: string | null = null;
  try {
    await deps.putObject(
      validationResultObjectKey,
      validationResultJson({
        result_version: RESULT_VERSION,
        attestation_id: attestation.id,
        attempt_id: attemptId,
        manifest_object_key: manifestObjectKey,
        outcome: 'failed',
        merkle_root: null,
        error,
        completed_at: now.toISOString(),
      }),
      'application/json',
    );
    resultKeyWritten = validationResultObjectKey;
  } catch {
    resultKeyWritten = null;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(submissionAttempts)
      .set({
        state: 'failed',
        failedAt: now,
        updatedAt: now,
        validationError: error,
        validationResultObjectKey: resultKeyWritten,
      })
      .where(eq(submissionAttempts.id, attemptId));
    await tx
      .update(attestations)
      .set({
        state: 'failed_needs_review',
        failedAt: now,
        updatedAt: now,
      })
      .where(eq(attestations.id, attestation.id));
  });
  // Audit outside the state-change transaction (see validateAttempt success
  // path for rationale).
  await writeAuditEvent(db, {
    tenantId: attestation.tenantId,
    category: AUDIT_CATEGORIES.attestationLifecycle,
    action: AUDIT_ACTIONS.attestationValidationFailed,
    targetType: 'submission_attempt',
    targetId: attemptId,
    payload: { error },
  });
  const webhookDeliveries = await createWebhookDeliveries(db, {
    tenantId: attestation.tenantId,
    eventType: 'attestation.failed',
    occurredAt: now,
    data: {
      attestationId: attestation.id,
      attemptId,
      error,
    },
  });
  if (deps.enqueueWebhookDelivery) {
    await Promise.all(
      webhookDeliveries.map((delivery) =>
        deps.enqueueWebhookDelivery!(delivery.id),
      ),
    );
  }
  return { ok: false, state: 'failed', error };
};
