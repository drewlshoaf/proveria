// M10 walkthrough — extends M8 with text shingling so the consumer can
// verify either the whole file OR a single passage (a "shingle") against
// the manifest. The plaintext never leaves the producer; the consumer
// re-hashes the same passage locally to produce the canonical shingle
// payload hash and pastes it into the portal lookup form.

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
import {
  computeShinglePayloadHash,
  generateShingles,
  normalizeForShingling,
  tokenizeNormalized,
} from '@proveria/shingling';

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

// A short, single-paragraph corpus chosen to (a) have plenty of tokens for
// the standard 7/1 preset and (b) yield a memorable first-shingle the user
// can read back from the printed source text.
const CORPUS = [
  'Proveria preserves provenance for digital documents.',
  'Each producer normalizes and shingles plaintext locally before submitting.',
  'Only the canonical shingle payload hashes ever leave the producer machine.',
  'A consumer can recompute the same hash from the same passage to verify a match.',
  'Plaintext never crosses the network and never lives on Proveria servers.',
].join(' ');

const main = async (): Promise<void> => {
  log('\nProveria — M10 walkthrough\n' + '─'.repeat(48));
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
  const adminEmail = `m10-admin-${suffix}@example.com`;
  const consumerEmail = `m10-consumer-${suffix}@example.com`;
  const password = 'm10-walkthrough-pw-123';

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

  // 2. Plan upgrade — shingling is a paid feature (docs/v1 §22.2). Free
  //    tenants would be rejected with shingling_not_in_plan:free at
  //    validateAttempt time, so the walkthrough upgrades to team_pro.
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${adminTenantId}`;
  } finally {
    await handle.close();
  }
  log('2. plan        → Team Pro (shingling allowed)');

  // 3. Pair device
  const kp = await generateEd25519Keypair();
  const init = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M10 Mac',
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
        name: 'M10 Mac',
        profileId: randomUUID(),
      }),
    },
  );
  const deviceId = ((await approve.json()) as { device: { id: string } })
    .device.id;
  log(`3. paired      → ${deviceId}`);

  // 4. Project
  await sessionReq(adminCookie, 'POST', `/tenants/${adminTenantSlug}/projects`, {
    slug: 'shingled-corpus',
    name: 'Shingled corpus',
    templateSlug: 'general_provenance',
  });
  log('4. project     → shingled-corpus (private)');

  // 5. Write the corpus to a real file and shingle it locally — exactly
  //    what the desktop's submit flow does.
  const corpusPath = join(tmpdir(), `m10-corpus-${suffix}.txt`);
  await writeFile(corpusPath, CORPUS + '\n');
  const bytes = await readFile(corpusPath);
  const fileHashHex = createHash('sha256').update(bytes).digest('hex');
  const filePayloadHash = new Uint8Array(Buffer.from(fileHashHex, 'hex'));

  const text = bytes.toString('utf8');
  const normalized = normalizeForShingling(text);
  const paragraphs = tokenizeNormalized(normalized);
  const tokenCount = paragraphs.reduce((s, p) => s + p.length, 0);
  const shingles = generateShingles(paragraphs, 'standard');
  if (shingles.length === 0) fail('corpus too short to produce shingles');
  log(
    `5. shingled    → ${shingles.length} shingles, ${tokenCount} tokens (standard 7/1)`,
  );

  // 6. Build a manifest that mirrors what the desktop assembles in
  //    apps/desktop/src/attestation.ts: one whole-file leaf + N shingle
  //    leaves with extraction_metadata keyed by 'src_<first 8 bytes hex>'.
  const createPath = `/tenants/${adminTenantSlug}/projects/shingled-corpus/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label: `corpus-${suffix}` });

  const shingleCtx = {
    preset: 'standard' as const,
    sourceExtractionMethod: 'plain-text/v1' as const,
  };
  const shingleLeaves = shingles.map((s) => ({
    leafType: LEAF_TYPES.shingleSha256V1,
    canonicalPayloadHash: computeShinglePayloadHash(s.text, shingleCtx),
    metadata: {
      preset: 'standard',
      source_extraction_method: 'plain-text/v1',
      source_index: s.sourceIndex,
    },
  }));
  const sourceKey =
    'src_' + Buffer.from(filePayloadHash.subarray(0, 8)).toString('hex');
  const manifest: Manifest = buildManifest({
    tenantId: created.tenant.id,
    projectId: created.project.id,
    attestationId: created.attestation.id,
    attemptId: created.attempt.id,
    createdByUserId: adminUserId,
    createdByDeviceId: deviceId,
    createdByProfileId: randomUUID(),
    leaves: [
      {
        leafType: LEAF_TYPES.fileSha256V1,
        canonicalPayloadHash: filePayloadHash,
        metadata: { byte_size: bytes.length },
      },
      ...shingleLeaves,
    ],
    shinglingVersion: '1.0',
    extractionMetadata: {
      [sourceKey]: {
        method: 'plain-text/v1',
        paragraph_count: paragraphs.length,
        token_count: tokenCount,
        shingle_count: shingles.length,
      },
    },
    sourceSummary: {
      file_count: 1,
      shingle_count: shingles.length,
      ocr_page_count: 0,
    },
  });
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  const sig = await signEd25519(digest, kp.privateKey);
  const signedManifest: Manifest = {
    ...manifest,
    signatures: [
      { signer_kind: 'device', key_id: deviceId, algorithm: 'ed25519', signature: sig },
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

  // 7. Wait for confirmation.
  let confirmed = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const d = await sessionReq<{ attestation: { state: string } }>(
      adminCookie,
      'GET',
      `/attestations/${created.attestation.id}`,
    );
    if (d.attestation.state === 'confirmed') {
      confirmed = true;
      break;
    }
  }
  if (!confirmed) fail('attestation did not confirm in time');
  log('6. confirmed   → manifest accepted with shingle leaves');

  // 8. Consumer + grant
  const consumerReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: consumerEmail, password }),
  });
  const consumerCookie = (consumerReg.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]!;
  await sessionReq(
    adminCookie,
    'POST',
    `/tenants/${adminTenantSlug}/attestations/${created.attestation.id}/access-grants`,
    { email: consumerEmail },
  );
  log(`7. consumer    → ${consumerEmail} (granted)`);

  // 9. Pick a demo shingle for the consumer to paste. The shingles in
  //    `shingles` are ordered by source_index, so shingles[0] is the first
  //    window of the corpus — easy to point at in the printed instructions.
  const demoShingle = shingles[0]!;
  const demoShinglePayloadHash = computeShinglePayloadHash(
    demoShingle.text,
    shingleCtx,
  );
  const demoShingleHashHex = Buffer.from(demoShinglePayloadHash).toString(
    'hex',
  );

  log('\n' + '─'.repeat(48));
  log('✓ TENANT SEEDED');
  log('─'.repeat(48));
  log(`
LOGINS

  Admin (Team Pro)
    ${adminEmail}  /  ${password}

  Consumer (granted access)
    ${consumerEmail}  /  ${password}

THINGS TO VERIFY BY HAND — Milestone 10
=======================================

C36 — shingling-v1 spec is locked
  docs/protocol/v1/shingling-v1.md
    • Concrete normalization pipeline, presets (standard 7/1, broad 12/3,
      sensitive 4/1), and the 0x02-prefixed canonical payload format.

C38 — server plan-gate
  A Free tenant cannot submit shingle leaves. To prove it, downgrade this
  tenant in psql and try to re-submit — the worker would reject with
  'shingling_not_in_plan:free' and the attestation would move to
  failed_needs_review.

C39 — portal pre-lookup metadata exposes shingling presence
  As the CONSUMER, open the lookup page:
    ${PORTAL}/lookups/${created.attestation.id}
    • Coverage row reads "whole-file + shingles"
    • New row "Shingling presets: standard"
    • Hint under the SHA-256 input now mentions shingle payload hashes

C39 — shingle lookup MATCH
  Paste this shingle payload hash into the lookup form and click Verify:
    ${demoShingleHashHex}
    • Result is a MATCH against leaf_type shingle/sha256/v1
    • Result package is Proveria-signed (Team Pro)

C39 — whole-file lookup MATCH (regression check)
  Paste this whole-file SHA-256 into the same form:
    ${fileHashHex}
    • Result is a MATCH against leaf_type file/sha256/v1

C39 — NO-MATCH
  Paste any 64-char hex that isn't above (e.g. all zeros) — verbatim §9.3
  no-match statement, still signed.

WHAT THE SHINGLE COVERS
=======================
Source text (the first window of ${demoShingle.text.split(' ').length} tokens
the shingler produced from the corpus at ${corpusPath}):

    "${demoShingle.text}"

The consumer would produce the same hash by running the same passage
through @proveria/shingling's normalize → tokenize → shingle pipeline
with the 'standard' preset. Pasting the precomputed hash above is the
same thing — the math is deterministic by spec, so the bytes match.
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
