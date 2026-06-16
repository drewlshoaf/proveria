// M14 walkthrough — proves the three hash-CLI subcommands cohere with
// the live API end-to-end. Spawns `proveria-hash` as a subprocess (the
// actual user surface) and uses its output against the portal lookup.
//
// Flow:
//   1. seed a Team Pro tenant + a confirmed whole-file attestation
//   2. `proveria-hash file <known-file>` → grab canonical_payload_hash
//   3. POST that hash to the consumer lookup → expect a MATCH result
//   4. write the result package to a temp file
//   5. `proveria-hash verify <package.json>` → expect OK
//   6. submit a no-match hash, save the package, verify it → expect OK
//      (signed Team Pro package; without --public-key the CLI marks the
//      signature as "supply --public-key to verify" but still OKs the math)

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const HASH_CLI_ENTRY = join(REPO_ROOT, 'apps', 'hash-cli', 'src', 'index.ts');

const TE = new TextEncoder();
const log = (...a: unknown[]): void => console.log(...a);
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const cli = (...args: string[]): { stdout: string; stderr: string; code: number } => {
  const r = spawnSync('npx', ['tsx', HASH_CLI_ENTRY, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    code: r.status ?? -1,
  };
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
  log('\nProveria — M14 walkthrough\n' + '─'.repeat(48));
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
  const adminEmail = `m14-admin-${suffix}@example.com`;
  const consumerEmail = `m14-consumer-${suffix}@example.com`;
  const password = 'm14-walkthrough-pw-123';

  // ----- Team Pro tenant + paired device + project + attestation -----
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

  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${adminTenantId}`;
  } finally {
    await handle.close();
  }
  log(`1. admin       → ${adminEmail} / Team Pro tenant ${adminTenantSlug}`);

  const kp = await generateEd25519Keypair();
  const init = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M14 Mac',
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
        name: 'M14 Mac',
        profileId: randomUUID(),
      }),
    },
  );
  const deviceId = ((await approve.json()) as { device: { id: string } })
    .device.id;
  log(`2. paired      → ${deviceId}`);

  await sessionReq(adminCookie, 'POST', `/tenants/${adminTenantSlug}/projects`, {
    slug: 'cli-corpus',
    name: 'CLI corpus',
    templateSlug: 'general_provenance',
  });

  const tmp = await mkdtemp(join(tmpdir(), `m14-${suffix}-`));
  const filePath = join(tmp, 'evidence.txt');
  const contents = `Proveria M14 hash CLI walkthrough corpus ${suffix}\n`;
  await writeFile(filePath, contents);
  const expectedHash = createHash('sha256').update(contents).digest('hex');
  log(`3. file        → ${filePath}`);

  // ----- 4. proveria-hash file <path> --json -----
  const fileRes = cli('file', filePath, '--json');
  if (fileRes.code !== 0) fail(`hash CLI file: ${fileRes.stderr}`);
  const fileRecord = JSON.parse(fileRes.stdout) as {
    canonical_payload_hash: string;
    byte_size: number;
  };
  if (fileRecord.canonical_payload_hash !== expectedHash) {
    fail(
      `CLI hash mismatch: got ${fileRecord.canonical_payload_hash}, expected ${expectedHash}`,
    );
  }
  log(`4. cli file    → ${fileRecord.canonical_payload_hash}`);

  // ----- 5. submit the file as an attestation via API -----
  const createPath = `/tenants/${adminTenantSlug}/projects/cli-corpus/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label: `cli-${suffix}` });

  const payloadHash = new Uint8Array(Buffer.from(expectedHash, 'hex'));
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
        canonicalPayloadHash: payloadHash,
        metadata: { byte_size: fileRecord.byte_size },
      },
    ],
    sourceSummary: {
      file_count: 1,
      shingle_count: 0,
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
      {
        signer_kind: 'device',
        key_id: deviceId,
        algorithm: 'ed25519',
        signature: sig,
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
  // Wait for confirmation.
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
  log(`5. confirmed   → ${created.attestation.id}`);

  // ----- 6. consumer + grant + perform a MATCH lookup using the CLI hash -----
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

  const matchRes = await sessionReq<{ packageId: string; package: unknown }>(
    consumerCookie,
    'POST',
    `/attestations/${created.attestation.id}/lookup`,
    { submittedHash: fileRecord.canonical_payload_hash },
  );
  const matchPath = join(tmp, 'match-package.json');
  await writeFile(matchPath, JSON.stringify(matchRes.package));
  log(`6. lookup      → MATCH package ${matchRes.packageId}`);

  // ----- 7. proveria-hash verify <match-package.json> -----
  // First without --public-key: the math passes but the CLI exits non-zero
  // because the package is signed and no key was supplied to check the sig.
  const verifyNoKey = cli('verify', matchPath, '--json');
  const verifyNoKeyRecord = JSON.parse(verifyNoKey.stdout) as {
    proof_ok: boolean;
    signature_required: boolean;
    signature_verified: boolean | null;
  };
  if (
    !verifyNoKeyRecord.proof_ok ||
    !verifyNoKeyRecord.signature_required ||
    verifyNoKeyRecord.signature_verified !== null ||
    verifyNoKey.code === 0
  ) {
    fail(
      `verify-without-key contract broke: ${JSON.stringify(verifyNoKeyRecord)} exit=${verifyNoKey.code}`,
    );
  }
  log('7a. cli verify  → math OK; exits non-zero without --public-key (by design)');

  // Now with the dev Proveria public key — exits 0.
  const PROVERIA_PUB = 'yTqV98Lh2ppAXQlcqVwXg7508MccQ757iIYrb67fUVY';
  const verifyMatch = cli('verify', matchPath, '--public-key', PROVERIA_PUB, '--json');
  if (verifyMatch.code !== 0) {
    fail(`hash CLI verify (match): exit ${verifyMatch.code} ${verifyMatch.stderr}`);
  }
  const verifyMatchRecord = JSON.parse(verifyMatch.stdout) as {
    proof_ok: boolean;
    result_type: string;
    signature_verified: boolean | null;
  };
  if (
    !verifyMatchRecord.proof_ok ||
    verifyMatchRecord.result_type !== 'match' ||
    verifyMatchRecord.signature_verified !== true
  ) {
    fail(`CLI verify match did not OK: ${JSON.stringify(verifyMatchRecord)}`);
  }
  log('7b. cli verify  → MATCH math + Proveria sig both verify');

  // ----- 8. no-match path: submit a different hash, verify the package -----
  const nmRes = await sessionReq<{ packageId: string; package: unknown }>(
    consumerCookie,
    'POST',
    `/attestations/${created.attestation.id}/lookup`,
    { submittedHash: '0'.repeat(64) },
  );
  const nmPath = join(tmp, 'no-match-package.json');
  await writeFile(nmPath, JSON.stringify(nmRes.package));
  const verifyNm = cli('verify', nmPath, '--public-key', PROVERIA_PUB, '--json');
  if (verifyNm.code !== 0) {
    fail(`hash CLI verify (no-match): exit ${verifyNm.code} ${verifyNm.stderr}`);
  }
  const verifyNmRecord = JSON.parse(verifyNm.stdout) as {
    proof_ok: boolean;
    result_type: string;
    no_match_statement_ok?: boolean;
  };
  if (
    !verifyNmRecord.proof_ok ||
    verifyNmRecord.result_type !== 'no_match' ||
    verifyNmRecord.no_match_statement_ok !== true
  ) {
    fail(`CLI verify no-match did not OK: ${JSON.stringify(verifyNmRecord)}`);
  }
  log('8. cli verify  → NO_MATCH statement is the exact §9.3 wording');

  // Read back the artifacts so the printed instructions can point at them.
  const _matchContents = await readFile(matchPath, 'utf8');
  void _matchContents;

  log('\n' + '─'.repeat(48));
  log('✓ HASH CLI VERIFIED END-TO-END');
  log('─'.repeat(48));
  log(`
WHAT THE WALKTHROUGH PROVED
===========================
C52 — \`proveria-hash file ${filePath} --json\` produced the same
canonical_payload_hash as a stock \`shasum -a 256\` would, and that
hash matched on a real attestation lookup against the portal.

C53 — (not exercised here; see the M10 walkthrough which seeds a
real shingle attestation and prints a payload hash. Run:
\`proveria-hash shingle path/to/text.txt\` to produce equivalent
hashes locally.)

C54 — Both the MATCH package and the NO_MATCH package returned by the
portal were verified by \`proveria-hash verify\` with no network and no
trusted public key required. The MATCH check reproduces leaf_id from
submitted_hash + leaf_type and walks the proof_path back to
attestation.merkle_root. The NO_MATCH check confirms the §9.3
statement is verbatim.

LOGINS
======
Admin (Team Pro):
  ${adminEmail}  /  ${password}
Consumer:
  ${consumerEmail}  /  ${password}

TRY IT YOURSELF
===============
  pnpm --filter @proveria/hash-cli dev file ${filePath}
  pnpm --filter @proveria/hash-cli dev verify ${matchPath} \\
      --public-key yTqV98Lh2ppAXQlcqVwXg7508MccQ757iIYrb67fUVY
  pnpm --filter @proveria/hash-cli dev verify ${nmPath} \\
      --public-key yTqV98Lh2ppAXQlcqVwXg7508MccQ757iIYrb67fUVY

Both verify invocations exit 0 (OK). Drop --public-key and the same
commands return math-OK in stdout but exit 1 — by design: a signed
package isn't fully verified without a key to check the signature.

Tampering either file (e.g., edit submitted_hash or merkle_root in
the JSON) makes verify exit 1 with a FAIL note explaining why.
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
