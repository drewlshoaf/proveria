// M6 walkthrough — seeds a tenant rich enough to exercise every M6 portal
// surface (project management, tenant settings, attestation depth, audit
// log), then prints a portal click-path checklist.
//
// Prereqs — the local stack must be running:
//   • docker compose up -d            (postgres, redis, minio)
//   • pnpm --filter @proveria/api dev          → :3001
//   • pnpm --filter @proveria/worker dev
//   • pnpm --filter @proveria/portal dev       → :3000
//
// Run:
//   pnpm --filter @proveria/worker walkthrough:m6
//
// Unlike the M5 script this one also does a single direct DB write — it
// upgrades the seeded tenant to Team Pro. Paid tenants are normally
// manually provisioned (docs/v1 §8.4); doing it here lets the plan-limit
// card and the full audit log light up.

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
    fail(`API not reachable at ${API} — is the api dev server running?`);
  }
  try {
    const portal = await fetch(PORTAL);
    if (!portal.ok) fail(`Portal not reachable at ${PORTAL} (${portal.status})`);
  } catch {
    fail(`Portal not reachable at ${PORTAL} — is the portal dev server running?`);
  }
};

// Submit + finalize an attestation through the desktop code path.
const submitAttestation = async (
  kp: { publicKey: string; privateKey: string },
  deviceId: string,
  userId: string,
  tenantSlug: string,
  projectSlug: string,
  label: string,
): Promise<string> => {
  const createPath = `/tenants/${tenantSlug}/projects/${projectSlug}/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label });

  const filePath = join(tmpdir(), `m6-${randomUUID().slice(0, 8)}.txt`);
  await writeFile(filePath, `Proveria M6 walkthrough payload for ${label}\n`);
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
  return created.attestation.id;
};

const main = async (): Promise<void> => {
  log('\nProveria — M6 walkthrough\n' + '─'.repeat(48));
  await checkStackUp();
  log('✓ stack reachable (API + portal)\n');

  const suffix = randomUUID().slice(0, 8);
  const email = `m6-${suffix}@example.com`;
  const password = 'm6-walkthrough-pw-123';

  // 1. Register the admin — server creates a personal tenant + session.
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (reg.status !== 201) fail(`register → ${reg.status}`);
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!;
  const regBody = (await reg.json()) as {
    user: { id: string };
    tenant: { id: string; slug: string };
  };
  const { id: userId } = regBody.user;
  const { id: tenantId, slug: tenantSlug } = regBody.tenant;
  log(`1. registered  → ${email} / tenant ${tenantSlug}`);

  // 2. Upgrade the tenant to Team Pro via a direct DB write. Paid tenants are
  //    manually provisioned (docs/v1 §8.4) — this is the seed-script stand-in.
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${tenantId}`;
  } finally {
    await handle.close();
  }
  log('2. plan        → upgraded to Team Pro (direct DB write)');

  // 3. Pair a device.
  const kp = await generateEd25519Keypair();
  const initiate = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M6 Walkthrough Mac',
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
        name: 'M6 Walkthrough Mac',
        profileId: randomUUID(),
      }),
    },
  );
  if (approve.status !== 200) fail(`approve → ${approve.status}`);
  const deviceId = (
    (await approve.json()) as { device: { id: string } }
  ).device.id;
  log(`3. paired      → device ${deviceId}`);

  // 4. Create two projects — one stays active, one gets archived.
  for (const [slug, name] of [
    ['active-corpus', 'Active corpus'],
    ['retired-corpus', 'Retired corpus'],
  ]) {
    await sessionReq(cookie, 'POST', `/tenants/${tenantSlug}/projects`, {
      slug,
      name,
      templateSlug: 'general_provenance',
    });
  }
  await sessionReq(
    cookie,
    'POST',
    `/tenants/${tenantSlug}/projects/retired-corpus/archive`,
  );
  log('4. projects    → active-corpus (active), retired-corpus (archived)');

  // 5. Create a pending invitation.
  await sessionReq(cookie, 'POST', `/tenants/${tenantSlug}/invitations`, {
    email: `teammate-${suffix}@example.com`,
    role: 'producer',
  });
  log(`5. invitation  → teammate-${suffix}@example.com (producer, pending)`);

  // 6. Submit + confirm an attestation in the active project.
  const attestationId = await submitAttestation(
    kp,
    deviceId,
    userId,
    tenantSlug,
    'active-corpus',
    `q2-snapshot-${suffix}`,
  );
  let state = 'validating';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const d = await sessionReq<{ attestation: { state: string } }>(
      cookie,
      'GET',
      `/attestations/${attestationId}`,
    );
    if (d.attestation.state !== 'validating') {
      state = d.attestation.state;
      break;
    }
  }
  if (state !== 'confirmed') fail(`attestation did not confirm (state=${state})`);
  log(`6. attestation → ${attestationId} confirmed`);

  log('\n' + '─'.repeat(48));
  log('✓ TENANT SEEDED');
  log('─'.repeat(48));
  log(`
Log in:  ${email}  /  ${password}

THINGS TO VERIFY BY HAND — Milestone 6
======================================

C20 — Project management
  ${PORTAL}/tenants/${tenantSlug}
    • "New project" form (you are an admin) — create one, it appears in the grid
    • "Show archived" toggle reveals retired-corpus with an "archived" badge
    • Plan card reads "Team Pro" with the §22.2 limits
  ${PORTAL}/tenants/${tenantSlug}/projects/retired-corpus
    • "Restore project" button (admin only) + the archived notice
  ${PORTAL}/tenants/${tenantSlug}/projects/active-corpus
    • "Archive project" button — archiving hides it from the default grid

C21 — Members & devices
  ${PORTAL}/tenants/${tenantSlug}/settings
    • Members table — you, as tenant_admin
    • Pending invitations — teammate-${suffix}@example.com, with Revoke
      and the send-invite form
    • Paired devices — "M6 Walkthrough Mac", with Revoke

C22 — Attestation depth + plan limits
  ${PORTAL}/tenants/${tenantSlug}/projects/active-corpus/attestations/${attestationId}
    • "Submission attempts" card — one validated attempt marked confirmed
    • Cryptographic provenance + signed receipt cards (from M5)

C23 — Audit log
  ${PORTAL}/tenants/${tenantSlug}/audit
    • Full audit trail (Team Pro → scope "full"): registration, device
      pairing, project create + archive, invitation, attestation lifecycle,
      receipt issued — newest first
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
