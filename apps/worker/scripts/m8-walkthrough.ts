// M8 walkthrough — extends M7's seeding with a consumer lookup so the user
// can exercise the full PDF + verification-link lifecycle in the portal:
// PDF download for receipts and result packages, the universal /v/[id]
// page, and the admin revoke/rotate controls.

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

const main = async (): Promise<void> => {
  log('\nProveria — M8 walkthrough\n' + '─'.repeat(48));
  for (const [name, url] of [
    ['api', `${API}/healthz`],
    ['portal', PORTAL],
  ]) {
    try {
      const r = await fetch(url);
      if (!r.ok) fail(`${name} reachable but ${r.status} (${url})`);
    } catch {
      fail(`${name} not reachable at ${url}`);
    }
  }
  log('✓ stack reachable\n');

  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `m8-admin-${suffix}@example.com`;
  const consumerEmail = `m8-consumer-${suffix}@example.com`;
  const password = 'm8-walkthrough-pw-123';

  // 1. Admin
  const adminReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminCookie = (adminReg.headers.get('set-cookie') ?? '').split(';')[0]!;
  const adminBody = (await adminReg.json()) as {
    user: { id: string };
    tenant: { id: string; slug: string };
  };
  const adminUserId = adminBody.user.id;
  const adminTenantId = adminBody.tenant.id;
  const adminTenantSlug = adminBody.tenant.slug;
  log(`1. admin       → ${adminEmail} / tenant ${adminTenantSlug}`);

  // 2. Plan upgrade
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${adminTenantId}`;
  } finally {
    await handle.close();
  }
  log('2. plan        → Team Pro (signed packages)');

  // 3. Pair device
  const kp = await generateEd25519Keypair();
  const init = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M8 Mac',
      platform: 'darwin',
      appVersion: '0.0.0',
    }),
  });
  const { code } = (await init.json()) as { code: string };
  const approve = await fetch(
    `${API}/tenants/${adminTenantSlug}/devices/pairing/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        code,
        name: 'M8 Mac',
        profileId: randomUUID(),
      }),
    },
  );
  const deviceId = (
    (await approve.json()) as { device: { id: string } }
  ).device.id;
  log(`3. paired      → ${deviceId}`);

  // 4. Project
  await sessionReq(adminCookie, 'POST', `/tenants/${adminTenantSlug}/projects`, {
    slug: 'verifiable-corpus',
    name: 'Verifiable corpus',
    templateSlug: 'general_provenance',
  });
  log('4. project     → verifiable-corpus (private)');

  // 5. Submit + confirm an attestation with three known files
  const createPath = `/tenants/${adminTenantSlug}/projects/verifiable-corpus/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label: `corpus-${suffix}` });

  const filePayloads: { name: string; hashHex: string }[] = [];
  for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) {
    const path = join(tmpdir(), `m8-${suffix}-${name}`);
    await writeFile(path, `Proveria M8 walkthrough — ${name} (${suffix})\n`);
    const bytes = await readFile(path);
    filePayloads.push({
      name,
      hashHex: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  const manifest: Manifest = buildManifest({
    tenantId: created.tenant.id,
    projectId: created.project.id,
    attestationId: created.attestation.id,
    attemptId: created.attempt.id,
    createdByUserId: adminUserId,
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

  let receiptLinkId: string | null = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const d = await sessionReq<{
      attestation: { state: string; verificationLinkId: string | null };
    }>(adminCookie, 'GET', `/attestations/${created.attestation.id}`);
    if (d.attestation.state === 'confirmed' && d.attestation.verificationLinkId) {
      receiptLinkId = d.attestation.verificationLinkId;
      break;
    }
  }
  if (!receiptLinkId) fail('attestation did not confirm in time');
  log(`5. confirmed   → receipt link ${receiptLinkId}`);

  // 6. Consumer + grant
  const consumerReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: consumerEmail, password }),
  });
  const consumerCookie = (
    consumerReg.headers.get('set-cookie') ?? ''
  ).split(';')[0]!;
  await sessionReq(
    adminCookie,
    'POST',
    `/tenants/${adminTenantSlug}/attestations/${created.attestation.id}/access-grants`,
    { email: consumerEmail },
  );
  log(`6. consumer    → ${consumerEmail} (granted)`);

  // 7. Consumer performs a MATCH lookup — gets a result package + linkId
  const match = await sessionReq<{
    packageId: string;
    linkId: string;
  }>(consumerCookie, 'POST', `/attestations/${created.attestation.id}/lookup`, {
    submittedHash: filePayloads[0]!.hashHex,
  });
  log(`7. match       → result link ${match.linkId}`);

  log('\n' + '─'.repeat(48));
  log('✓ TENANTS SEEDED');
  log('─'.repeat(48));
  log(`
LOGINS

  Admin (Team Pro)
    ${adminEmail}  /  ${password}

  Consumer (granted access)
    ${consumerEmail}  /  ${password}

THINGS TO VERIFY BY HAND — Milestone 8
======================================

C28 — universal /v/:linkId page (works WITHOUT login)
  Receipt:  ${PORTAL}/v/${receiptLinkId}
  Result :  ${PORTAL}/v/${match.linkId}
    • Both pages show the artifact + verified/INVALID badge
    • "Download PDF" produces a brand-styled PDF with a QR code

C30 — receipt PDF (rendered at issuance, instant download)
  Sign in as admin, open the attestation detail page, click "Download PDF"
  next to "View signed receipt":
    ${PORTAL}/tenants/${adminTenantSlug}/projects/verifiable-corpus/attestations/${created.attestation.id}
  Open the PDF and scan its QR with a phone — it lands on the /v/ page
  above.

C30 (result) — lookup result PDF (rendered on first download, ~3s)
  Sign in as consumer, open the result page:
    ${PORTAL}/lookup-results/${match.packageId}
  Click "Download PDF" — first click waits while the worker renders;
  subsequent clicks return the cached PDF instantly.

C29 — admin link lifecycle on the attestation detail page
  Same admin page as above — scroll to "Verification links":
    • Two links listed: one receipt, one lookup_result
    • "Rotate" issues a new link id; the old QR (in any already-printed
      PDF) stops resolving
    • "Revoke" makes the /v/:linkId page show "Link unavailable"
    • The underlying signed package is unaffected by either

For demoing the no-match flow (as the consumer):
  Paste 0000000000000000000000000000000000000000000000000000000000000000
  into the lookup page — you'll get a no-match result with the verbatim
  §9.3 statement.

Known file hashes (the corpus admin committed):
${filePayloads.map((f) => `    • ${f.hashHex}  (${f.name})`).join('\n')}
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
