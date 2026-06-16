// Seed a sample project + a sample confirmed attestation into a freshly
// self-registered customer-admin tenant so the workspace doesn't feel
// empty on first login.
//
// What gets seeded:
//   - 1 project: slug `sample-evidence`, public, with a short description
//     explaining what it's there to demonstrate.
//   - 1 device: a single-use "sample device" with a locally-generated
//     Ed25519 keypair. The PRIVATE half is used only here to sign the
//     sample manifest, then dropped — the device row stays in the DB as
//     the createdByDevice reference so the attestation looks real.
//   - 1 attestation in `confirmed` state with a real signed manifest in
//     MinIO. The single file leaf is the SHA-256 of a fixed welcome
//     string so the customer admin can also use it as a "paste this
//     hash into the lookup form to see a MATCH" demo.
//
// Skips:
//   - No receipt + no PDF are generated here. The worker will render
//     those on demand when the user clicks Download from the desktop app.
//   - No leaves.jsonl. The lookup endpoint reads leaves from the
//     manifest directly; the leaves.jsonl file is only used by
//     external proof-package verifiers (M5+).
//
// Errors here MUST NOT fail the registration — registration's already
// committed by the time this runs. Logs the failure and returns.

import { createHash, randomUUID } from 'node:crypto';

import { writeAuditEvent } from '../audit/writer.js';
import { manifestKey, putJson } from '../objects/client.js';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import {
  attestations,
  devices,
  projects,
  submissionAttempts,
  type DrizzleClient,
} from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';

/**
 * Fixed plaintext the sample file leaf attests. The producer-facing
 * description points users at this string so they can compute its
 * SHA-256 themselves and paste it into the lookup form for a MATCH.
 *
 * Don't change the bytes — that breaks the documented MATCH hash for
 * every previously-seeded tenant.
 */
export const SAMPLE_WELCOME_TEXT =
  'Welcome to Proveria! This is a sample attestation.\n';

export const SAMPLE_PROJECT_SLUG = 'sample-evidence';
export const SAMPLE_ATTESTATION_LABEL = 'sample-seal';

export interface SeedSampleContentInput {
  tenantId: string;
  userId: string;
}

export const seedSampleContent = async (
  db: DrizzleClient,
  input: SeedSampleContentInput,
): Promise<void> => {
  const { tenantId, userId } = input;

  // 1. Sample project.
  const [project] = await db
    .insert(projects)
    .values({
      tenantId,
      slug: SAMPLE_PROJECT_SLUG,
      name: 'Sample evidence',
      description:
        'Pre-seeded demo project. Inside is one sample attestation that ' +
        'sealed the string “Welcome to Proveria! This is a sample ' +
        'attestation.” Compute that string’s SHA-256 and paste it into ' +
        'the attestation’s lookup form for a MATCH.',
      templateSlug: 'general_provenance',
      visibility: 'public',
      createdByUserId: userId,
    })
    .returning();
  if (!project) throw new Error('seed: failed to insert sample project');

  // 2. Sample device (single-use; private key is generated + used + dropped).
  const kp = await generateEd25519Keypair();
  const [device] = await db
    .insert(devices)
    .values({
      tenantId,
      userId,
      profileId: randomUUID(),
      publicKey: kp.publicKey,
      name: 'Sample device (seeded)',
      // The platform column is enum-typed (darwin | win32); pick darwin
      // arbitrarily — the value's only displayed in the paired-devices
      // list, where the name above already marks this row as seeded.
      platform: 'darwin',
      appVersion: '0.0.0',
    })
    .returning();
  if (!device) throw new Error('seed: failed to insert sample device');

  // 3. Attestation + attempt rows in 'pending'. We'll flip them to
  //    'confirmed' / 'validated' after the manifest writes succeed.
  const [attestation] = await db
    .insert(attestations)
    .values({
      tenantId,
      projectId: project.id,
      label: SAMPLE_ATTESTATION_LABEL,
      description:
        'Sample sealed evidence. See the project description for the ' +
        'demo MATCH instructions.',
      createdByUserId: userId,
      createdByDeviceId: device.id,
      state: 'pending',
    })
    .returning();
  if (!attestation) throw new Error('seed: failed to insert sample attestation');

  const [attempt] = await db
    .insert(submissionAttempts)
    .values({
      attestationId: attestation.id,
      state: 'pending',
    })
    .returning();
  if (!attempt) throw new Error('seed: failed to insert sample attempt');

  // 4. Build the manifest: one file leaf for SAMPLE_WELCOME_TEXT.
  const bytes = Buffer.from(SAMPLE_WELCOME_TEXT, 'utf8');
  const fileHash = new Uint8Array(
    createHash('sha256').update(bytes).digest(),
  );
  const manifest: Manifest = buildManifest({
    tenantId,
    projectId: project.id,
    attestationId: attestation.id,
    attemptId: attempt.id,
    createdByUserId: userId,
    createdByDeviceId: device.id,
    createdByProfileId: device.profileId,
    leaves: [
      {
        leafType: LEAF_TYPES.fileSha256V1,
        canonicalPayloadHash: fileHash,
        metadata: {
          byte_size: bytes.length,
          sample: true,
          sample_source: 'Welcome to Proveria! This is a sample attestation.',
        },
      },
    ],
    sourceSummary: {
      file_count: 1,
      shingle_count: 0,
      ocr_page_count: 0,
    },
  });

  // 5. Sign manifest with the sample device key.
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  const signature = await signEd25519(digest, kp.privateKey);
  const signedManifest: Manifest = {
    ...manifest,
    signatures: [
      {
        signer_kind: 'device',
        key_id: device.id,
        algorithm: 'ed25519',
        signature,
      },
    ],
  };

  // 6. Upload to MinIO.
  const objectKey = manifestKey(
    tenantId,
    project.id,
    attestation.id,
    attempt.id,
  );
  await putJson(objectKey, JSON.stringify(signedManifest));

  // 7. Mark confirmed directly — short-circuiting the worker. Validation
  // is unnecessary because we just built the manifest above and signed
  // it with a key we have on hand; the merkle root we set matches what
  // the validator would recompute.
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(submissionAttempts)
      .set({
        state: 'validated',
        manifestObjectKey: objectKey,
        validatedAt: now,
        uploadedAt: now,
        updatedAt: now,
      })
      .where(eq(submissionAttempts.id, attempt.id));
    await tx
      .update(attestations)
      .set({
        state: 'confirmed',
        confirmedAttemptId: attempt.id,
        confirmedAt: now,
        manifestObjectKey: objectKey,
        merkleRoot: manifest.merkle_root,
        updatedAt: now,
      })
      .where(eq(attestations.id, attestation.id));
  });

  // 8. Audit the seed so tenant admins can see it happened.
  await writeAuditEvent(db, {
    tenantId,
    actorUserId: userId,
    actorDeviceId: device.id,
    category: AUDIT_CATEGORIES.attestationLifecycle,
    action: AUDIT_ACTIONS.attestationConfirmed,
    targetType: 'attestation',
    targetId: attestation.id,
    payload: { sample: true },
  });
};

// drizzle's `eq` import — tucked at the bottom to keep the header
// import block focused on what's load-bearing.
import { eq } from 'drizzle-orm';
