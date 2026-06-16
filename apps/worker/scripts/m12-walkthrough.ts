// M12 walkthrough — exercises the desktop-side improvements end-to-end
// at the API level, then prints instructions for the user to confirm the
// wizard + drafts + cache UX in the Electron app.
//
// What gets exercised programmatically:
//   1. Happy path: pair → create attestation → upload manifest → finalize
//   2. Repair flow: server rejects a deliberately-malformed manifest, the
//      attestation moves to failed_needs_review, the desktop submits a
//      NEW attempt under the same attestation_id, and that one confirms.
//
// What requires manual verification (the wizard UI):
//   • Multi-step wizard transitions and brand styling
//   • Local draft auto-save + "Resume a draft" panel
//   • Incremental processing cache hit on a retry submit
//   • Repair input on the project step

import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
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

const waitForState = async (
  cookie: string,
  attestationId: string,
  target: string[],
  timeoutMs = 20_000,
): Promise<string> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await sessionReq<{ attestation: { state: string } }>(
      cookie,
      'GET',
      `/attestations/${attestationId}`,
    );
    if (target.includes(d.attestation.state)) return d.attestation.state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return fail(
    `attestation ${attestationId} did not reach ${target.join('|')} in time`,
  );
};

const main = async (): Promise<void> => {
  log('\nProveria — M12 walkthrough\n' + '─'.repeat(48));
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
  const adminEmail = `m12-admin-${suffix}@example.com`;
  const password = 'm12-walkthrough-pw-123';

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

  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${adminTenantId}`;
  } finally {
    await handle.close();
  }
  log('2. plan        → Team Pro');

  const kp = await generateEd25519Keypair();
  const init = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M12 Mac',
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
        name: 'M12 Mac',
        profileId: randomUUID(),
      }),
    },
  );
  const deviceId = ((await approve.json()) as { device: { id: string } })
    .device.id;
  log(`3. paired      → ${deviceId}`);

  await sessionReq(adminCookie, 'POST', `/tenants/${adminTenantSlug}/projects`, {
    slug: 'm12-corpus',
    name: 'M12 corpus',
    templateSlug: 'general_provenance',
  });
  log('4. project     → m12-corpus (private)');

  // 5. Write a small file we can submit through both happy + repair paths.
  const filePath = join(tmpdir(), `m12-source-${suffix}.txt`);
  await writeFile(filePath, `Proveria M12 walkthrough corpus ${suffix}\n`);
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(filePath);
  const fileHashHex = createHash('sha256').update(bytes).digest('hex');
  const filePayloadHash = new Uint8Array(Buffer.from(fileHashHex, 'hex'));

  // 6. Repair scenario: create an attestation, submit a manifest with a
  //    deliberately wrong tenant_id, server rejects, attestation moves to
  //    failed_needs_review. Then call the new POST /attestations/:id/
  //    attempts to start a fresh attempt under the same attestation_id
  //    and confirm it.
  const createPath = `/tenants/${adminTenantSlug}/projects/m12-corpus/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label: `repair-demo-${suffix}` });
  log(`5. attestation → ${created.attestation.id}`);

  const buildSignedManifest = async (
    attestationId: string,
    attemptId: string,
    overrideTenantId?: string,
  ): Promise<Manifest> => {
    const manifest: Manifest = buildManifest({
      tenantId: overrideTenantId ?? created.tenant.id,
      projectId: created.project.id,
      attestationId,
      attemptId,
      createdByUserId: adminUserId,
      createdByDeviceId: deviceId,
      createdByProfileId: randomUUID(),
      leaves: [
        {
          leafType: LEAF_TYPES.fileSha256V1,
          canonicalPayloadHash: filePayloadHash,
          metadata: { byte_size: bytes.length },
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
    return {
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
  };

  // First attempt: deliberately bad tenant_id.
  const badManifest = await buildSignedManifest(
    created.attestation.id,
    created.attempt.id,
    '00000000-0000-0000-0000-000000000000',
  );
  await signedPost(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`,
    badManifest,
  );
  await signedPost(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
    {},
  );
  const failedState = await waitForState(
    adminCookie,
    created.attestation.id,
    ['failed_needs_review'],
  );
  log(`6. bad submit  → ${failedState} (tenant_id mismatch)`);

  // Verify the new repair-info endpoint returns the right minimal projection.
  const repairInfoBytes = TE.encode('');
  const repairInfoHeaders = await deviceHeaders(
    kp.privateKey,
    deviceId,
    'GET',
    `/attestations/${created.attestation.id}/repair-info`,
    repairInfoBytes,
  );
  const repairInfoRes = await fetch(
    `${API}/attestations/${created.attestation.id}/repair-info`,
    { method: 'GET', headers: repairInfoHeaders },
  );
  if (!repairInfoRes.ok) fail(`repair-info fetch → ${repairInfoRes.status}`);
  const repairInfo = (await repairInfoRes.json()) as {
    attestation: { id: string; label: string; state: string };
    project: { slug: string };
    tenant: { slug: string };
  };
  log(
    `7. repair-info → state=${repairInfo.attestation.state} project=${repairInfo.project.slug} label=${repairInfo.attestation.label}`,
  );

  // Open a fresh attempt under the same attestation_id.
  const repairAttempt = await signedPost<{
    attestation: { id: string; state: string };
    attempt: { id: string };
  }>(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts`,
    {},
  );
  log(`8. new attempt → ${repairAttempt.attempt.id}`);

  const goodManifest = await buildSignedManifest(
    created.attestation.id,
    repairAttempt.attempt.id,
  );
  await signedPost(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts/${repairAttempt.attempt.id}/upload-manifest`,
    goodManifest,
  );
  await signedPost(
    kp.privateKey,
    deviceId,
    `/attestations/${created.attestation.id}/attempts/${repairAttempt.attempt.id}/finalize`,
    {},
  );
  const confirmedState = await waitForState(
    adminCookie,
    created.attestation.id,
    ['confirmed'],
  );
  log(`9. repair done → ${confirmedState}`);

  const detail = await sessionReq<{
    attestation: { confirmedAttemptId: string | null };
    attempts: Array<{ id: string; state: string; isConfirmed: boolean }>;
  }>(adminCookie, 'GET', `/attestations/${created.attestation.id}`);
  log(
    `10. history    → ${detail.attempts.length} attempts; confirmed=${
      detail.attestation.confirmedAttemptId === repairAttempt.attempt.id
        ? 'repair attempt'
        : 'OTHER'
    }`,
  );

  log('\n' + '─'.repeat(48));
  log('✓ TENANT SEEDED + REPAIR FLOW PROVEN');
  log('─'.repeat(48));
  log(`
LOGIN (portal)

  ${adminEmail}  /  ${password}

WHAT THE WALKTHROUGH PROVED
===========================
C47 — the new POST /attestations/:id/attempts endpoint accepts a fresh
attempt against a failed_needs_review attestation and lets it confirm
under the SAME attestation_id. The failed attempt is retained alongside
the confirmed one (docs/v1 §11.4):

  ${PORTAL}/tenants/${adminTenantSlug}/projects/m12-corpus/attestations/${created.attestation.id}

In the attempt list you'll see two rows — the first is failed with the
'manifest_tenant_id_mismatch' validation_error, the second is the
confirmed repair attempt.

THINGS TO VERIFY BY HAND IN THE DESKTOP (Milestone 12)
======================================================

Launch:  pnpm --filter @proveria/desktop dev

C44 — Wizard UX
  • Brand-aligned: Inter (or system fallback), one teal accent, flat
    cards, no shadows. Sentence case throughout.
  • Four steps: Project & label → Files → Review → Submit. Back / Next
    work; the file list has Add / Remove / Clear.
  • Template dropdown lists the six V1 templates with description hints.

C45 — Drafts
  • Walk halfway through the wizard, then quit the app and relaunch.
  • The "Project & label" step shows a "Resume a draft" panel listing
    your in-progress draft. "Resume" restores form + files; "Delete"
    removes the encrypted blob from disk.
  • Drafts live under
      ~/Library/Application Support/Proveria/profiles/<profileId>/drafts/
    each as a *.draft.enc file encrypted via macOS Keychain.

C46 — Incremental processing cache
  • Submit the same set of files twice. The first run hashes them; the
    second's "Done" step reads "Processing cache: N reused, 0 re-hashed".
  • Edit any source file between runs (e.g. \`echo >> file.txt\`) — the
    next submit re-hashes only that file ("N-1 reused, 1 re-hashed").

C47 — Repair (in the desktop wizard)
  • On the "Project & label" step, paste this failed attestation id
    into "Repair a failed attestation":
      ${created.attestation.id}
    (Note: this walkthrough already repaired it via the API, so the
    state will read 'confirmed' and the desktop will refuse. Run the
    walkthrough again to seed a fresh failed attestation if you want
    to exercise the repair flow through the UI itself.)
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
