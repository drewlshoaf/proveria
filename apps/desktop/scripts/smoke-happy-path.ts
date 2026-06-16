import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import { buildManifest, type Manifest } from '@proveria/manifest';

const API_URL = (
  process.env.PROVERIA_SMOKE_API_URL ?? 'http://127.0.0.1:3001'
).replace(/\/+$/, '');
const PASSWORD = 'happy-path-password-123';
const encoder = new TextEncoder();

interface DeviceKey {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

const log = (message: string, details?: Record<string, unknown>): void => {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[smoke] ${message}${suffix}`);
};

const sha256 = (bytes: Uint8Array | string): Uint8Array =>
  createHash('sha256').update(bytes).digest();

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const fromHex = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, 'hex'));

const jsonFetch = async <T>(
  path: string,
  init: RequestInit,
): Promise<{ body: T; headers: Headers; status: number }> => {
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
  return { body: body as T, headers: response.headers, status: response.status };
};

const cookieHeader = (headers: Headers): string => {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) throw new Error('registration did not return a session cookie');
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

const main = async (): Promise<void> => {
  const runId = randomUUID().slice(0, 8);
  const email = `happy-${runId}@example.com`;
  const workspaceName = `Happy Path ${runId}`;
  const projectSlug = `happy-${runId}`;
  const attestationLabel = `happy-${runId}`;
  const fileText = `Proveria happy path ${runId}\n`;
  const fileBytes = encoder.encode(fileText);
  const submittedHash = hex(sha256(fileBytes));

  log('registering account', { email });
  const registered = await postJson<{
    user: { id: string; email: string };
    tenant: null | { id: string; slug: string };
  }>('/auth/register', { email, password: PASSWORD });
  const cookies = cookieHeader(registered.headers);

  log('creating workspace', { workspaceName });
  const workspace = await postJson<{
    tenant: {
      id: string;
      slug: string;
      name: string;
      plan: string;
      role: string;
    };
  }>('/tenants', { name: workspaceName }, { cookie: cookies });

  log('minting desktop device key');
  const keypair = await generateEd25519Keypair();
  const minted = await postJson<{
    device: { id: string };
    tenant: {
      id: string;
      slug: string;
      name: string;
      plan: string;
      role: string;
    };
    user: { id: string; email: string };
  }>('/auth/device/mint', {
    email,
    password: PASSWORD,
    publicKey: keypair.publicKey,
    deviceName: `Happy Path ${runId}`,
    platform: 'darwin',
    appVersion: 'smoke',
  });
  const device: DeviceKey = {
    deviceId: minted.body.device.id,
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
  };

  log('creating project', { projectSlug });
  const projectPath = `/tenants/${workspace.body.tenant.slug}/projects`;
  const project = await signedJson<{
    project: { id: string; slug: string };
  }>(device, 'POST', projectPath, {
    slug: projectSlug,
    name: `Happy Path ${runId}`,
    templateSlug: 'general_provenance',
  });

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
        canonicalPayloadHash: fromHex(submittedHash),
        metadata: {
          file_name: `happy-${runId}.txt`,
          byte_size: fileBytes.byteLength,
          hash_source: 'smoke',
        },
      },
    ],
    sourceSummary: {
      file_count: 1,
      shingle_count: 0,
      ocr_page_count: 0,
    },
    extractionMetadata: {
      runner: 'scripts/local-happy-path.sh',
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

  log('uploading signed manifest', {
    attestationId: created.attestation.id,
    attemptId: created.attempt.id,
  });
  await signedJson(
    device,
    'POST',
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`,
    signedManifest,
  );

  log('finalizing attestation');
  await signedJson(
    device,
    'POST',
    `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
    {},
  );

  log('waiting for worker confirmation');
  const confirmed = await waitFor('attestation confirmation', async () => {
    const detail = await signedJson<{
      attestation: {
        id: string;
        state: string;
        merkleRoot: string | null;
        packageId: string | null;
        receiptAvailable: boolean;
      };
      attempts: Array<{ id: string; state: string; validationError: string | null }>;
    }>(device, 'GET', `/attestations/${created.attestation.id}`);

    const failed = detail.attempts.find((attempt) => attempt.state === 'failed');
    if (failed) {
      throw new Error(failed.validationError ?? 'attempt failed');
    }
    return detail.attestation.state === 'confirmed' &&
      detail.attestation.receiptAvailable
      ? detail
      : null;
  });

  log('fetching receipt');
  const receipt = await signedJson<{
    signatureValid: boolean;
    receipt: { attestation_id: string; merkle_root: string; package_id: string };
  }>(device, 'GET', `/attestations/${created.attestation.id}/receipt`);
  if (!receipt.signatureValid) {
    throw new Error('receipt signature did not verify');
  }

  const result = {
    email,
    password: PASSWORD,
    tenant: workspace.body.tenant.slug,
    project: project.project.slug,
    attestationId: confirmed.attestation.id,
    packageId: receipt.receipt.package_id,
    merkleRoot: receipt.receipt.merkle_root,
    submittedHash,
    fileText,
  };

  if (process.env.PROVERIA_SMOKE_RESULT_PATH) {
    await writeFile(
      process.env.PROVERIA_SMOKE_RESULT_PATH,
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
  }

  log('confirmed', result);
};

main().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
