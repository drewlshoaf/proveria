import { createHash, randomUUID } from 'node:crypto';

import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import { createClient, type ClientHandle } from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';

const API_URL = (
  process.env.PROVERIA_SMOKE_API_URL ?? 'http://127.0.0.1:3001'
).replace(/\/+$/, '');
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';
const PASSWORD = 'exact-image-password-123';
const encoder = new TextEncoder();

interface DeviceKey {
  deviceId: string;
  privateKey: string;
}

const log = (message: string, details?: Record<string, unknown>): void => {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[exact-image:smoke] ${message}${suffix}`);
};

const sha256 = (bytes: Uint8Array | string): Uint8Array =>
  createHash('sha256').update(bytes).digest();

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const fromHex = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, 'hex'));

const jsonFetch = async <T>(
  path: string,
  init: RequestInit,
): Promise<{ body: T; headers: Headers }> => {
  const response = await fetch(`${API_URL}${path}`, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => null);
  }
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed ${response.status}: ${JSON.stringify(
        body,
      )}`,
    );
  }
  return { body: body as T, headers: response.headers };
};

const cookieHeader = (headers: Headers): string => {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) throw new Error('response did not include a session cookie');
  return setCookie
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join('; ');
};

const postJson = async <T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ body: T; headers: Headers }> =>
  jsonFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const sessionJson = async <T>(
  cookie: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> => {
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const response = await jsonFetch<T>(path, {
    method,
    headers:
      bodyText === undefined
        ? { cookie }
        : { cookie, 'content-type': 'application/json' },
    body: bodyText,
  });
  return response.body;
};

const signatureHeaders = async (
  device: DeviceKey,
  method: string,
  path: string,
  bodyBytes: Uint8Array,
): Promise<Record<string, string>> => {
  const timestamp = Date.now();
  const canonical = [
    'proveria-device-v1',
    String(timestamp),
    method.toUpperCase(),
    path,
    hex(sha256(bodyBytes)),
  ].join('\n');
  return {
    'X-Proveria-Device-Id': device.deviceId,
    'X-Proveria-Timestamp': String(timestamp),
    'X-Proveria-Signature': await signEd25519(
      encoder.encode(canonical),
      device.privateKey,
    ),
  };
};

const signedJson = async <T>(
  device: DeviceKey,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> => {
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const bodyBytes = encoder.encode(bodyText);
  const headers = await signatureHeaders(device, method, path, bodyBytes);
  const response = await jsonFetch<T>(path, {
    method,
    headers:
      body === undefined
        ? headers
        : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : bodyText,
  });
  return response.body;
};

const waitFor = async <T>(
  label: string,
  fn: () => Promise<T | null>,
  timeoutMs = 60_000,
): Promise<T> => {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `${label} did not complete in ${timeoutMs}ms${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`,
  );
};

const setTenantPlan = async (tenantId: string): Promise<void> => {
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${tenantId}`;
  } finally {
    await handle.close();
  }
};

const tinyPng = (): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    ),
  );

const differentPngHash = (): string =>
  hex(
    sha256(
      new Uint8Array(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      ),
    ),
  );

const main = async (): Promise<void> => {
  const runId = randomUUID().slice(0, 8);
  const email = `exact-image-${runId}@example.com`;
  const workspaceName = `Exact Image ${runId}`;
  const projectSlug = `exact-image-${runId}`;
  const attestationLabel = `exact-image-${runId}`;
  const imageBytes = tinyPng();
  const submittedHash = hex(sha256(imageBytes));

  log('registering account', { email });
  const registered = await postJson<{ user: { id: string } }>('/auth/register', {
    email,
    password: PASSWORD,
  });
  const cookies = cookieHeader(registered.headers);

  log('creating workspace', { workspaceName });
  const workspace = await postJson<{
    tenant: { id: string; slug: string; plan: string };
  }>('/tenants', { name: workspaceName }, { cookie: cookies });

  log('upgrading workspace to Team Pro');
  await setTenantPlan(workspace.body.tenant.id);

  log('minting desktop device key');
  const keypair = await generateEd25519Keypair();
  const minted = await postJson<{
    device: { id: string };
    user: { id: string };
  }>('/auth/device/mint', {
    email,
    password: PASSWORD,
    publicKey: keypair.publicKey,
    deviceName: `Exact Image ${runId}`,
    platform: 'darwin',
    appVersion: 'smoke',
  });
  const device: DeviceKey = {
    deviceId: minted.body.device.id,
    privateKey: keypair.privateKey,
  };

  log('creating project', { projectSlug });
  const projectPath = `/tenants/${workspace.body.tenant.slug}/projects`;
  const project = await signedJson<{ project: { id: string; slug: string } }>(
    device,
    'POST',
    projectPath,
    {
      slug: projectSlug,
      name: `Exact Image ${runId}`,
      templateSlug: 'general_provenance',
    },
  );

  log('creating attestation', { attestationLabel });
  const attestationPath = `/tenants/${workspace.body.tenant.slug}/projects/${projectSlug}/attestations`;
  const created = await signedJson<{
    attestation: { id: string; state: string };
    attempt: { id: string; state: string };
    tenant: { id: string; slug: string };
    project: { id: string; slug: string };
  }>(device, 'POST', attestationPath, {
    label: attestationLabel,
  });

  const imagePayloadHash = fromHex(submittedHash);
  const manifest = buildManifest({
    tenantId: created.tenant.id,
    projectId: created.project.id,
    attestationId: created.attestation.id,
    attemptId: created.attempt.id,
    createdByUserId: minted.body.user.id,
    createdByDeviceId: device.deviceId,
    createdByProfileId: device.deviceId,
    leaves: [
      {
        leafType: LEAF_TYPES.fileSha256V1,
        canonicalPayloadHash: imagePayloadHash,
        metadata: {
          file_name: `exact-image-${runId}.png`,
          byte_size: imageBytes.byteLength,
          hash_source: 'smoke',
        },
      },
      {
        leafType: LEAF_TYPES.componentSha256V1,
        canonicalPayloadHash: imagePayloadHash,
        metadata: {
          component_method: 'exact-image-sha256/v1',
          media_type: 'image/png',
          file_name: `exact-image-${runId}.png`,
          byte_size: imageBytes.byteLength,
        },
      },
    ],
    sourceSummary: {
      file_count: 1,
      shingle_count: 0,
      component_count: 1,
      ocr_page_count: 0,
    },
    extractionMetadata: {
      image_proof: {
        method: 'exact-image-sha256/v1',
        media_type: 'image/png',
        component_count: 1,
      },
      runner: 'scripts/local-exact-image.sh',
    },
  });
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  const signedManifest: Manifest = {
    ...manifest,
    signatures: [
      {
        signer_kind: 'device',
        key_id: device.deviceId,
        algorithm: 'ed25519',
        signature: await signEd25519(digest, device.privateKey),
      },
    ],
  };

  log('uploading signed manifest');
  await signedJson(
    device,
    'POST',
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`,
    signedManifest,
  );
  await signedJson(
    device,
    'POST',
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
    {},
  );

  log('waiting for worker confirmation');
  await waitFor('attestation confirmation', async () => {
    const detail = await signedJson<{
      attestation: { id: string; state: string; receiptAvailable: boolean };
      attempts: Array<{ state: string; validationError: string | null }>;
    }>(device, 'GET', `/attestations/${created.attestation.id}`);
    const failed = detail.attempts.find((attempt) => attempt.state === 'failed');
    if (failed) throw new Error(failed.validationError ?? 'attempt failed');
    return detail.attestation.state === 'confirmed' &&
      detail.attestation.receiptAvailable
      ? detail
      : null;
  });

  log('checking receipt image coverage');
  const receipt = await signedJson<{
    signatureValid: boolean;
    receipt: {
      leaf_counts: { file: number; shingle: number; component: number };
      component_methods?: string[];
    };
  }>(device, 'GET', `/attestations/${created.attestation.id}/receipt`);
  if (!receipt.signatureValid) throw new Error('receipt signature invalid');
  if (receipt.receipt.leaf_counts.file !== 1) {
    throw new Error('receipt did not include one file leaf');
  }
  if (receipt.receipt.leaf_counts.component !== 1) {
    throw new Error('receipt did not include one exact image component leaf');
  }
  if (
    !receipt.receipt.component_methods?.includes('exact-image-sha256/v1')
  ) {
    throw new Error('receipt did not include exact-image-sha256/v1');
  }

  log('checking verifier pre-lookup metadata');
  const lookup = await sessionJson<{
    attestation: {
      coverageType: string;
      hashAlgorithm: string;
    };
  }>(cookies, 'GET', `/attestations/${created.attestation.id}/lookup`);
  if (!lookup.attestation.coverageType.includes('exact image proof')) {
    throw new Error(`unexpected coverage type: ${lookup.attestation.coverageType}`);
  }
  if (lookup.attestation.hashAlgorithm !== 'sha256') {
    throw new Error('lookup metadata did not report sha256');
  }

  log('performing exact image match lookup');
  const matchLookup = await sessionJson<{
    package: {
      package_id: string;
      result_type: 'match' | 'no_match';
      submitted_hash: string;
      match?: {
        leaf_type: string;
        component_method?: string;
        media_type?: string;
      } | null;
    };
    verificationUrl: string;
  }>(cookies, 'POST', `/attestations/${created.attestation.id}/lookup`, {
    submittedHash,
    lookupKind: 'exact_image',
  });
  if (matchLookup.package.result_type !== 'match') {
    throw new Error('exact image lookup did not return a match');
  }
  if (matchLookup.package.submitted_hash !== submittedHash) {
    throw new Error('exact image lookup did not keep the submitted hash');
  }
  if (matchLookup.package.match?.leaf_type !== LEAF_TYPES.componentSha256V1) {
    throw new Error('exact image lookup did not match a component leaf');
  }
  if (
    matchLookup.package.match?.component_method !== 'exact-image-sha256/v1'
  ) {
    throw new Error('exact image lookup did not carry component method');
  }
  if (matchLookup.package.match?.media_type !== 'image/png') {
    throw new Error('exact image lookup did not carry image media type');
  }
  if (!matchLookup.verificationUrl.startsWith('/v/')) {
    throw new Error('exact image match did not issue a public verification URL');
  }

  log('checking exact image public verification link');
  const matchVerification = await sessionJson<{
    targetType: string;
    payload: {
      package_id: string;
      result_type: 'match' | 'no_match';
      match?: { component_method?: string } | null;
    };
  }>(cookies, 'GET', matchLookup.verificationUrl);
  if (matchVerification.targetType !== 'lookup_result') {
    throw new Error('exact image verification link target was not lookup_result');
  }
  if (matchVerification.payload.package_id !== matchLookup.package.package_id) {
    throw new Error('exact image verification link returned the wrong package');
  }
  if (matchVerification.payload.result_type !== 'match') {
    throw new Error('exact image verification link returned the wrong result');
  }
  if (
    matchVerification.payload.match?.component_method !==
    'exact-image-sha256/v1'
  ) {
    throw new Error('exact image verification link lost component metadata');
  }

  log('performing exact image no-match lookup');
  const noMatchHash = differentPngHash();
  const noMatchLookup = await sessionJson<{
    package: {
      result_type: 'match' | 'no_match';
      submitted_hash: string;
    };
    verificationUrl: string;
  }>(cookies, 'POST', `/attestations/${created.attestation.id}/lookup`, {
    submittedHash: noMatchHash,
    lookupKind: 'exact_image',
  });
  if (noMatchLookup.package.result_type !== 'no_match') {
    throw new Error('exact image lookup did not return a no-match');
  }
  if (noMatchLookup.package.submitted_hash !== noMatchHash) {
    throw new Error('exact image no-match did not keep the submitted hash');
  }
  if (!noMatchLookup.verificationUrl.startsWith('/v/')) {
    throw new Error('exact image no-match did not issue a public verification URL');
  }

  log('confirmed', {
    email,
    tenant: workspace.body.tenant.slug,
    project: project.project.slug,
    attestationId: created.attestation.id,
    submittedHash,
  });
};

main().catch((err) => {
  console.error('[exact-image:smoke] failed:', err);
  process.exit(1);
});
