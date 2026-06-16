// M5 walkthrough — drives the full attestation + receipt flow against the
// live local stack, then prints a checklist of things to verify by hand
// (portal UI, MinIO artifacts, Postgres rows).
//
// Prereqs — the local stack must be running:
//   • docker compose up -d            (postgres, redis, minio)
//   • pnpm --filter @proveria/api dev          → :3001
//   • pnpm --filter @proveria/worker dev
//   • pnpm --filter @proveria/portal dev       → :3000
//
// Run:
//   pnpm --filter @proveria/worker walkthrough
//
// It exercises the desktop attestation code path (apps/desktop/src/
// attestation.ts) without Electron: device keypair, device-signed HTTP,
// local hashing, manifest build + sign, upload, finalize.

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import { buildManifest, type Manifest } from '@proveria/manifest';
import { verifyReceipt, type AttestationReceipt } from '@proveria/receipt';

const API = process.env.API_URL ?? 'http://127.0.0.1:3001';
const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3000';
// Worker dev-default Proveria platform public key (apps/worker/src/index.ts).
// If you set PROVERIA_SIGNING_PRIVATE_KEY on the worker, set its public half
// here too.
const PROVERIA_PUBLIC_KEY =
  process.env.PROVERIA_SIGNING_PUBLIC_KEY ??
  'yTqV98Lh2ppAXQlcqVwXg7508MccQ757iIYrb67fUVY';

const TE = new TextEncoder();
const log = (...a: unknown[]): void => console.log(...a);
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const deviceHeaders = async (
  privateKey: string,
  deviceId: string,
  method: string,
  path: string,
  bodyBytes: Uint8Array,
): Promise<Record<string, string>> => {
  const ts = Date.now();
  const bodyHashHex = createHash('sha256').update(bodyBytes).digest('hex');
  const canonical = [
    'proveria-device-v1',
    String(ts),
    method.toUpperCase(),
    path,
    bodyHashHex,
  ].join('\n');
  const signature = await signEd25519(TE.encode(canonical), privateKey);
  return {
    'X-Proveria-Device-Id': deviceId,
    'X-Proveria-Timestamp': String(ts),
    'X-Proveria-Signature': signature,
  };
};

const signedPost = async <T>(
  privateKey: string,
  deviceId: string,
  path: string,
  body: object,
): Promise<T> => {
  const bodyStr = JSON.stringify(body);
  const headers = await deviceHeaders(
    privateKey,
    deviceId,
    'POST',
    path,
    TE.encode(bodyStr),
  );
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  });
  if (!res.ok) {
    fail(`POST ${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
};

const checkStackUp = async (): Promise<void> => {
  try {
    const api = await fetch(`${API}/healthz`);
    if (!api.ok) fail(`API health check failed (${api.status})`);
  } catch {
    fail(`API not reachable at ${API} — is \`pnpm --filter @proveria/api dev\` running?`);
  }
  try {
    const portal = await fetch(PORTAL);
    if (!portal.ok) fail(`Portal not reachable at ${PORTAL} (${portal.status})`);
  } catch {
    fail(`Portal not reachable at ${PORTAL} — is \`pnpm --filter @proveria/portal dev\` running?`);
  }
};

const main = async (): Promise<void> => {
  log('\nProveria — M5 walkthrough\n' + '─'.repeat(48));
  await checkStackUp();
  log('✓ stack reachable (API + portal)\n');

  const suffix = randomUUID().slice(0, 8);
  const email = `walkthrough-${suffix}@example.com`;
  const password = 'walkthrough-pw-123';

  // 1. Register — server creates a personal tenant + session cookie.
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (reg.status !== 201) fail(`register → ${reg.status}`);
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!;
  const regBody = (await reg.json()) as {
    user: { id: string };
    tenant: { slug: string };
  };
  const userId = regBody.user.id;
  const tenantSlug = regBody.tenant.slug;
  log(`1. registered  → ${email} / tenant ${tenantSlug}`);

  // 2. Pair a device — desktop generates a keypair; portal owner approves.
  const kp = await generateEd25519Keypair();
  const initiate = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'Walkthrough Mac',
      platform: 'darwin',
      appVersion: '0.0.0',
    }),
  });
  const { code } = (await initiate.json()) as { code: string };
  const approve = await fetch(
    `${API}/tenants/${tenantSlug}/devices/pairing/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        code,
        name: 'Walkthrough Mac',
        profileId: randomUUID(),
      }),
    },
  );
  if (approve.status !== 200) fail(`approve → ${approve.status}`);
  const deviceId = (
    (await approve.json()) as { device: { id: string } }
  ).device.id;
  log(`2. paired      → device ${deviceId} (code ${code})`);

  // 3. Create a project (session-auth, like the portal would).
  const projectSlug = `walkthrough-${suffix}`;
  const proj = await fetch(`${API}/tenants/${tenantSlug}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      slug: projectSlug,
      name: 'Walkthrough project',
      templateSlug: 'general_provenance',
    }),
  });
  if (proj.status !== 201) fail(`project → ${proj.status} ${await proj.text()}`);
  log(`3. project     → ${projectSlug}`);

  // 4. Create the attestation (device-signed) — server issues the ids.
  const createPath = `/tenants/${tenantSlug}/projects/${projectSlug}/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label: `walkthrough-${suffix}` });
  log(`4. attestation → ${created.attestation.id}`);

  // 5. Hash a local file, build + sign the manifest.
  const filePath = join(tmpdir(), `walkthrough-${suffix}.txt`);
  await writeFile(filePath, `Proveria walkthrough payload ${suffix}\n`);
  const bytes = await readFile(filePath);
  const payloadHash = new Uint8Array(
    createHash('sha256').update(bytes).digest(),
  );
  const manifest: Manifest = buildManifest({
    tenantId: created.tenant.id,
    projectId: created.project.id,
    attestationId: created.attestation.id,
    attemptId: created.attempt.id,
    createdByUserId: userId,
    createdByDeviceId: deviceId,
    createdByProfileId: randomUUID(),
    leaves: [
      { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash },
    ],
    sourceSummary: { file_count: 1, shingle_count: 0, ocr_page_count: 0 },
  });
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  const signature = await signEd25519(digest, kp.privateKey);
  const signedManifest: Manifest = {
    ...manifest,
    signatures: [
      {
        signer_kind: 'device',
        key_id: deviceId,
        algorithm: 'ed25519',
        signature,
      },
    ],
  };
  log(`5. manifest    → merkle_root ${manifest.merkle_root}`);

  // 6. Upload the signed manifest, then finalize → enqueues worker validation.
  const uploadPath = `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`;
  await signedPost(kp.privateKey, deviceId, uploadPath, signedManifest);
  const finalizePath = `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`;
  await signedPost(kp.privateKey, deviceId, finalizePath, {});
  log('6. uploaded + finalized → worker validation enqueued');

  // 7. Poll the detail route until the receipt-generation job has issued.
  let detail: {
    state: string;
    merkleRoot: string | null;
    packageId: string | null;
    receiptAvailable: boolean;
  } | null = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(`${API}/attestations/${created.attestation.id}`, {
      headers: { cookie },
    });
    if (res.status !== 200) fail(`detail → ${res.status}`);
    const body = (await res.json()) as { attestation: typeof detail };
    if (body.attestation?.state === 'failed_needs_review') {
      fail('attestation failed validation — check the worker logs');
    }
    if (body.attestation?.receiptAvailable) {
      detail = body.attestation;
      break;
    }
  }
  if (!detail) fail('receipt was not issued within 20s — check the worker');
  log(`7. confirmed   → state=${detail.state} packageId=${detail.packageId}`);

  // 8. Fetch + verify the Proveria-signed receipt.
  const receiptRes = await fetch(
    `${API}/attestations/${created.attestation.id}/receipt`,
    { headers: { cookie } },
  );
  if (receiptRes.status !== 200) fail(`receipt → ${receiptRes.status}`);
  const receipt = (
    (await receiptRes.json()) as { receipt: AttestationReceipt }
  ).receipt;
  const sigValid = await verifyReceipt(receipt, PROVERIA_PUBLIC_KEY);
  const expectedDigestHex = Buffer.from(digest).toString('hex');
  log(`8. receipt     → signature valid=${sigValid}`);

  const ok =
    detail.state === 'confirmed' &&
    receipt.package_id === detail.packageId &&
    receipt.merkle_root === manifest.merkle_root &&
    receipt.manifest_canonical_sha256 === expectedDigestHex &&
    receipt.signatures[0]?.signer_kind === 'proveria' &&
    sigValid;

  log('\n' + '─'.repeat(48));
  log(
    ok
      ? '✓ AUTOMATED CHECKS PASSED'
      : '✗ AUTOMATED CHECKS FAILED — see mismatches above',
  );
  log('─'.repeat(48));

  // --- things to verify by hand --------------------------------------------
  const attemptId = created.attempt.id;
  const objectPrefix = `tenants/${created.tenant.id}/projects/${created.project.id}/attestations/${created.attestation.id}/attempts/${attemptId}`;

  log(`
THINGS TO VERIFY BY HAND
========================

1. PORTAL — attestation detail page
   Open:  ${PORTAL}/tenants/${tenantSlug}/projects/${projectSlug}/attestations/${created.attestation.id}
   Log in: ${email}  /  ${password}
   Check:
     • State badge reads "confirmed"
     • Cryptographic provenance card shows the Merkle root + package id
       (package id: ${detail.packageId})
     • "Signed receipt" card → click "View signed receipt"
       - signature reads "proveria · ed25519"
       - manifest canonical SHA-256 is shown
       - the full receipt JSON renders

2. PORTAL — project list
   Open:  ${PORTAL}/tenants/${tenantSlug}/projects/${projectSlug}
   Check: the attestation row links to the detail page above

3. OBJECT STORE — immutable per-attempt artifacts (docs/v1 §7.3)
   The attempt prefix should hold exactly four objects:
     mc ls --recursive local/proveria-artifacts/${objectPrefix}/
   Expect: manifest.json, leaves.jsonl, validation-result.json, receipt.json
   (MinIO console: http://127.0.0.1:9001 — proveria / proveria_dev_minio)

4. POSTGRES — row wiring
   psql "${process.env.DATABASE_URL ?? 'postgres://proveria:proveria_dev@localhost:5432/proveria'}" -c "
     SELECT state, merkle_root IS NOT NULL AS has_root,
            package_id, receipt_json_object_key IS NOT NULL AS has_receipt
     FROM attestations WHERE id = '${created.attestation.id}';"
   Expect: state=confirmed, has_root=t, package_id set, has_receipt=t

   psql ... -c "
     SELECT state, leaves_object_key IS NOT NULL AS has_leaves,
            validation_result_object_key IS NOT NULL AS has_result
     FROM submission_attempts WHERE id = '${attemptId}';"
   Expect: state=validated, has_leaves=t, has_result=t

5. RECEIPT — tamper check (optional)
   Edit one field of the receipt JSON and re-run verifyReceipt — it must
   return false. The signature binds every field via the §18 signing digest.
`);

  process.exit(ok ? 0 : 1);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
