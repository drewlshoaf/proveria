// M7 walkthrough — seeds an admin tenant with a confirmed paid attestation,
// a separate consumer account, and a granted access between them. Prints
// credentials and a click-path that exercises every M7 surface (grant UI,
// consumer landing, pre-lookup metadata, lookup with match + no-match,
// result page with the §16.1 share-by-id flow).
//
// Prereqs — the local stack must be running:
//   • docker compose up -d
//   • pnpm --filter @proveria/api dev          → :3001
//   • pnpm --filter @proveria/worker dev
//   • pnpm --filter @proveria/portal dev       → :3000
//
// Run:
//   pnpm --filter @proveria/worker walkthrough:m7

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
import { createClient, type ClientHandle } from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';

const API = process.env.API_URL ?? 'http://127.0.0.1:3001';
const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';

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
  if (!res.ok) fail(`POST ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

const sessionReq = async <T>(
  cookie: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

const checkStackUp = async (): Promise<void> => {
  try {
    const api = await fetch(`${API}/healthz`);
    if (!api.ok) fail(`API health check failed (${api.status})`);
  } catch {
    fail(`API not reachable at ${API}`);
  }
  try {
    const portal = await fetch(PORTAL);
    if (!portal.ok) fail(`Portal not reachable at ${PORTAL} (${portal.status})`);
  } catch {
    fail(`Portal not reachable at ${PORTAL}`);
  }
};

interface RegisterResult {
  email: string;
  password: string;
  cookie: string;
  userId: string;
  tenantId: string;
  tenantSlug: string;
}

const registerUser = async (
  email: string,
  password: string,
): Promise<RegisterResult> => {
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (reg.status !== 201) fail(`register ${email} → ${reg.status}`);
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!;
  const body = (await reg.json()) as {
    user: { id: string };
    tenant: { id: string; slug: string };
  };
  return {
    email,
    password,
    cookie,
    userId: body.user.id,
    tenantId: body.tenant.id,
    tenantSlug: body.tenant.slug,
  };
};

const main = async (): Promise<void> => {
  log('\nProveria — M7 walkthrough\n' + '─'.repeat(48));
  await checkStackUp();
  log('✓ stack reachable (API + portal)\n');

  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `m7-admin-${suffix}@example.com`;
  const consumerEmail = `m7-consumer-${suffix}@example.com`;
  const password = 'm7-walkthrough-pw-123';

  // 1. Register the producer-tenant admin.
  const admin = await registerUser(adminEmail, password);
  log(`1. admin       → ${admin.email} / tenant ${admin.tenantSlug}`);

  // 2. Upgrade admin's tenant to Team Pro so the result package is Proveria-signed.
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${admin.tenantId}`;
  } finally {
    await handle.close();
  }
  log('2. plan        → admin tenant upgraded to Team Pro (signed packages)');

  // 3. Pair a device.
  const kp = await generateEd25519Keypair();
  const initiate = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M7 Mac',
      platform: 'darwin',
      appVersion: '0.0.0',
    }),
  });
  const { code } = (await initiate.json()) as { code: string };
  const approve = await fetch(
    `${API}/tenants/${admin.tenantSlug}/devices/pairing/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        code,
        name: 'M7 Mac',
        profileId: randomUUID(),
      }),
    },
  );
  if (approve.status !== 200) fail(`approve → ${approve.status}`);
  const deviceId = (
    (await approve.json()) as { device: { id: string } }
  ).device.id;
  log(`3. paired      → ${deviceId}`);

  // 4. Create a project (will be private — Team Pro default).
  await sessionReq(admin.cookie, 'POST', `/tenants/${admin.tenantSlug}/projects`, {
    slug: 'verifiable-corpus',
    name: 'Verifiable corpus',
    templateSlug: 'general_provenance',
  });
  log('4. project     → verifiable-corpus (private)');

  // 5. Submit + confirm an attestation with three files; their SHA-256s are
  //    what the consumer will paste for a match.
  const createPath = `/tenants/${admin.tenantSlug}/projects/verifiable-corpus/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, {
    label: `corpus-${suffix}`,
  });

  const filePayloads: { name: string; bytes: Uint8Array; hashHex: string }[] = [];
  for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) {
    const path = join(tmpdir(), `m7-${suffix}-${name}`);
    await writeFile(path, `Proveria M7 walkthrough — ${name} (${suffix})\n`);
    const bytes = await readFile(path);
    const hashHex = createHash('sha256').update(bytes).digest('hex');
    filePayloads.push({ name, bytes, hashHex });
  }

  const manifest: Manifest = buildManifest({
    tenantId: created.tenant.id,
    projectId: created.project.id,
    attestationId: created.attestation.id,
    attemptId: created.attempt.id,
    createdByUserId: admin.userId,
    createdByDeviceId: deviceId,
    createdByProfileId: randomUUID(),
    leaves: filePayloads.map((f) => ({
      leafType: LEAF_TYPES.fileSha256V1,
      canonicalPayloadHash: new Uint8Array(Buffer.from(f.hashHex, 'hex')),
    })),
    sourceSummary: {
      file_count: filePayloads.length,
      shingle_count: 0,
      ocr_page_count: 0,
    },
  });
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  const signature = await signEd25519(digest, kp.privateKey);
  const signedManifest: Manifest = {
    ...manifest,
    signatures: [
      { signer_kind: 'device', key_id: deviceId, algorithm: 'ed25519', signature },
    ],
  };
  await signedPost(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`,
    signedManifest,
  );
  await signedPost(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
    {},
  );

  // Wait for the worker to confirm.
  let confirmed = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const d = await sessionReq<{ attestation: { state: string } }>(
      admin.cookie,
      'GET',
      `/attestations/${created.attestation.id}`,
    );
    if (d.attestation.state === 'confirmed') {
      confirmed = true;
      break;
    }
  }
  if (!confirmed) fail('attestation did not confirm in time');
  log(`5. attestation → ${created.attestation.id} confirmed`);

  // 6. Register the consumer (a separate account in their own free tenant).
  const consumer = await registerUser(consumerEmail, password);
  log(`6. consumer    → ${consumer.email}`);

  // 7. Admin grants the consumer access to the attestation.
  await sessionReq(
    admin.cookie,
    'POST',
    `/tenants/${admin.tenantSlug}/attestations/${created.attestation.id}/access-grants`,
    { email: consumer.email },
  );
  log('7. grant       → consumer granted access');

  log('\n' + '─'.repeat(48));
  log('✓ TENANTS SEEDED');
  log('─'.repeat(48));
  log(`
LOGINS

  Admin (Team Pro tenant)
    ${admin.email}  /  ${password}

  Consumer (granted access to the attestation above)
    ${consumer.email}  /  ${password}

THINGS TO VERIFY BY HAND — Milestone 7
======================================

C24 — Admin grants UI (sign in as the admin)
  ${PORTAL}/tenants/${admin.tenantSlug}/projects/verifiable-corpus/attestations/${created.attestation.id}
    • Scroll to "Consumer access" — the consumer's email is listed with
      a Revoke button
    • The grant form (by email) is below

C24 + C27 — Consumer landing (sign in as the consumer)
  ${PORTAL}/
    • "Attestations you can verify" card lists ${created.attestation.id}
      under tenant + project context
    • Clicking it goes to /lookups/${created.attestation.id}

C26 — Pre-lookup metadata (§16.3)
  ${PORTAL}/lookups/${created.attestation.id}
    • Producer, project, attestation label, confirmed-at, hash algorithm,
      signature status — file counts and leaf counts are NOT shown
    • Hash input field expects 64-char lowercase hex SHA-256

C26 + C27 — MATCH lookup (paste one of the known payload hashes)
  Hashes you can paste (each maps to a file the admin attested):
${filePayloads.map((f) => `    • ${f.hashHex}  (${f.name})`).join('\n')}
    • Submit → redirects to the result page with a green "verified" badge
      (Team Pro → Proveria-signed)
    • Result page shows Merkle root + proof depth + the full JSON

C26 + C27 — NO-MATCH lookup
  Paste any other 64-char hex, e.g.:
    • ${'0'.repeat(64)}
    • Submit → result page reads "No match" with the verbatim §9.3
      statement: "This hash was not present in this specific attestation's
      committed hash set."

C27 — Share-by-id (§16.1)
  Copy the package id from any result page and open in a private window —
  the result page loads without login (the API endpoint is unauthenticated).
  Tampering with the result.json in MinIO flips the signature badge to
  INVALID, same as the M5 receipt tamper-detect.

Tenant ids etc. for reference:
  admin    tenant_slug=${admin.tenantSlug}  attestation_id=${created.attestation.id}
  consumer tenant_slug=${consumer.tenantSlug}
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
