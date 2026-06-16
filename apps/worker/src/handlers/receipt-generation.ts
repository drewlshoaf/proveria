// Receipt generation (M5/C18). Enqueued by the worker when an attempt
// validates and its attestation confirms.
//
// Steps:
//   1. load the attestation; it must be 'confirmed' with this attempt as the
//      confirmed attempt. Idempotent: if a package_id is already set, no-op.
//   2. fetch the confirmed attempt's manifest from object storage
//   3. recompute the manifest's §8.1 canonical SHA-256 (binds the receipt to
//      the exact bytes the device signed)
//   4. buildAttestationReceipt() with the producer device signature status
//   5. write receipt.json to the attempt's immutable prefix (docs/v1 §7.3)
//   6. point the attestation row at the receipt + its package_id; audit row

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  writeAuditEvent,
} from '@proveria/audit';
import { buildSigningDigest } from '@proveria/crypto-core';
import {
  attestations,
  submissionAttempts,
  verificationLinks,
  type DrizzleClient,
} from '@proveria/db';
import type { Manifest } from '@proveria/manifest';
import {
  buildAttestationReceipt,
  type AttestationReceipt,
} from '@proveria/receipt';

import type { PutObject } from './attestation-validation.js';
import { createWebhookDeliveries } from './webhook-events.js';

export interface ReceiptGenerationResult {
  ok: boolean;
  packageId?: string;
  error?: string;
}

export interface GenerateReceiptDeps {
  db: DrizzleClient;
  fetchManifest: (objectKey: string) => Promise<string>;
  putObject: PutObject;
  /**
   * Optional PDF renderer. When provided, the handler renders the receipt
   * PDF alongside the JSON and caches it at the same prefix
   * (sibling receipt.pdf). Tests omit this to skip Chromium spin-up.
   */
  renderReceiptPdf?: (
    receipt: AttestationReceipt,
    linkId: string,
  ) => Promise<Buffer>;
  enqueueWebhookDelivery?: (deliveryId: string) => Promise<void>;
}

const siblingKey = (manifestObjectKey: string, filename: string): string =>
  manifestObjectKey.replace(/[^/]+$/, filename);

const newPackageId = (): string => `pkg_${randomBytes(16).toString('hex')}`;

export const generateReceipt = async (
  deps: GenerateReceiptDeps,
  attestationId: string,
  attemptId: string,
): Promise<ReceiptGenerationResult> => {
  const { db, fetchManifest, putObject } = deps;

  const attestationRows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.id, attestationId))
    .limit(1);
  const attestation = attestationRows[0];
  if (!attestation) {
    return { ok: false, error: 'attestation_not_found' };
  }
  if (
    attestation.state !== 'confirmed' ||
    attestation.confirmedAttemptId !== attemptId
  ) {
    return {
      ok: false,
      error: `attestation_not_confirmed_for_attempt:${attestation.state}`,
    };
  }
  // Idempotent: a retry of an already-issued receipt is a no-op.
  if (attestation.packageId) {
    return { ok: true, packageId: attestation.packageId };
  }

  const attemptRows = await db
    .select()
    .from(submissionAttempts)
    .where(eq(submissionAttempts.id, attemptId))
    .limit(1);
  const attempt = attemptRows[0];
  if (!attempt || !attempt.manifestObjectKey) {
    return { ok: false, error: 'attempt_missing_manifest_key' };
  }
  const manifestObjectKey = attempt.manifestObjectKey;

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fetchManifest(manifestObjectKey)) as Manifest;
  } catch (err) {
    return { ok: false, error: `manifest_fetch_failed:${(err as Error).message}` };
  }

  // The §8.1 canonical digest — the exact bytes the manifest signer signed.
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  const manifestCanonicalSha256 = Buffer.from(digest).toString('hex');

  const manifestSig = manifest.signatures.find((s) => s.signer_kind === 'device');
  const publicApiManifest =
    (manifest.policy_context as { submission_channel?: unknown } | undefined)
      ?.submission_channel === 'public_api';
  if (!manifestSig && !publicApiManifest) {
    return { ok: false, error: 'manifest_missing_signature' };
  }

  const packageId = newPackageId();
  const now = new Date();
  const extractionMethods = new Set<string>();
  const componentMethods = new Set<string>();
  for (const leaf of manifest.leaf_set) {
    if (leaf.leaf_type === 'shingle/sha256/v1') {
      const method = (leaf.metadata as { source_extraction_method?: unknown })
        ?.source_extraction_method;
      if (typeof method === 'string') extractionMethods.add(method);
    }
    if (leaf.leaf_type === 'component/sha256/v1') {
      const method = (leaf.metadata as { component_method?: unknown })
        ?.component_method;
      if (typeof method === 'string') componentMethods.add(method);
    }
  }
  const receipt = buildAttestationReceipt({
    packageId,
    tenantId: attestation.tenantId,
    projectId: attestation.projectId,
    attestationId: attestation.id,
    attestationLabel: attestation.label,
    confirmedAttemptId: attemptId,
    manifestObjectKey,
    manifestCanonicalSha256,
    merkleRoot: manifest.merkle_root,
    leafCounts: {
      file: manifest.leaf_counts.file,
      shingle: manifest.leaf_counts.shingle,
      component: manifest.leaf_counts.component,
    },
    extractionMethods: [...extractionMethods],
    componentMethods: [...componentMethods],
    hashAlgorithm: manifest.hash_algorithm,
    protocolVersion: manifest.protocol_version,
    deviceSignature: manifestSig
      ? {
          key_id: manifestSig.key_id,
          algorithm: 'ed25519',
          verified: true,
        }
      : {
          key_id: 'public-api-unsigned-manifest',
          algorithm: 'ed25519',
          verified: false,
        },
    confirmedAt: (attestation.confirmedAt ?? now).toISOString(),
    issuedAt: now.toISOString(),
  });
  const receiptObjectKey = siblingKey(manifestObjectKey, 'receipt.json');
  await putObject(
    receiptObjectKey,
    JSON.stringify(receipt, null, 2),
    'application/json',
  );

  // Issue the verification link (§18.4) for this receipt — it's what the
  // PDF QR + verification URL will point at. The link id is short + prefixed.
  const linkId = `vrf_${randomBytes(12).toString('hex')}`;

  await db.transaction(async (tx) => {
    await tx
      .update(attestations)
      .set({
        receiptJsonObjectKey: receiptObjectKey,
        packageId,
        updatedAt: now,
      })
      .where(eq(attestations.id, attestation.id));
    await tx.insert(verificationLinks).values({
      id: linkId,
      tenantId: attestation.tenantId,
      targetType: 'receipt',
      targetRef: attestation.id,
      // System-issued (the worker has no user actor).
      createdByUserId: null,
    });
  });

  // Audit outside the state-change transaction so the Enterprise hash-chain
  // append can manage its own nested transaction + advisory lock without
  // fighting the caller's drizzle context (docs/v1 §19.4).
  await writeAuditEvent(db, {
    tenantId: attestation.tenantId,
    category: AUDIT_CATEGORIES.attestationLifecycle,
    action: AUDIT_ACTIONS.receiptIssued,
    targetType: 'attestation',
    targetId: attestation.id,
    payload: { packageId, receiptObjectKey, linkId },
  });

  const webhookDeliveries = await createWebhookDeliveries(db, {
    tenantId: attestation.tenantId,
    eventType: 'receipt.issued',
    occurredAt: now,
    data: {
      attestationId: attestation.id,
      packageId,
      receiptObjectKey,
      receiptVerificationLinkId: linkId,
    },
  });
  if (deps.enqueueWebhookDelivery) {
    await Promise.all(
      webhookDeliveries.map((delivery) =>
        deps.enqueueWebhookDelivery!(delivery.id),
      ),
    );
  }

  // Render + cache the PDF. The JSON receipt above is the canonical artifact
  // (docs/v1 §18.1) — a PDF render failure does NOT undo the issuance, just
  // leaves it pending; a re-trigger can render later.
  if (deps.renderReceiptPdf) {
    try {
      const pdfBytes = await deps.renderReceiptPdf(receipt, linkId);
      const receiptPdfObjectKey = siblingKey(manifestObjectKey, 'receipt.pdf');
      await deps.putObject(
        receiptPdfObjectKey,
        pdfBytes,
        'application/pdf',
      );
      await db
        .update(attestations)
        .set({ receiptPdfObjectKey })
        .where(eq(attestations.id, attestation.id));
    } catch {
      // Swallow: the JSON receipt is canonical; PDF can be re-rendered later.
    }
  }

  return { ok: true, packageId };
};
