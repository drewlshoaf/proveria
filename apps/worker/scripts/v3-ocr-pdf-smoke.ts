import { createHash, randomUUID } from 'node:crypto';

import { createCanvas } from '@napi-rs/canvas';
import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import { createClient, type ClientHandle } from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';
import { OCR_V1, renderPdfPages, runOcr } from '@proveria/ocr';
import {
  computeShinglePayloadHash,
  generateShingles,
  normalizeForShingling,
  tokenizeNormalized,
} from '@proveria/shingling';
import { PDFDocument } from 'pdf-lib';

const API_URL = (
  process.env.PROVERIA_SMOKE_API_URL ?? 'http://127.0.0.1:3001'
).replace(/\/+$/, '');
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';
const PASSWORD = 'ocr-pdf-password-123';
const encoder = new TextEncoder();

interface DeviceKey {
  deviceId: string;
  privateKey: string;
}

const OCR_SOURCE_TEXT = [
  'Proveria scanned document smoke test preserves provenance for important records without exposing the private source text.',
  'The desktop application renders scanned pages, derives OCR text locally, and submits only deterministic content proof hashes.',
  'A verifier can later reproduce a continuous passage hash and confirm that the passage was represented in the committed proof set.',
].join(' ');

const log = (message: string, details?: Record<string, unknown>): void => {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[ocr-pdf:smoke] ${message}${suffix}`);
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

const wrapText = (paragraph: string, maxChars: number): string[] => {
  const lines: string[] = [];
  let current = '';
  for (const word of paragraph.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const renderTextImage = (text: string): Uint8Array => {
  const width = 1224;
  const height = 1584;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'black';
  ctx.font = '48px sans-serif';
  let y = 160;
  for (const line of wrapText(text, 48)) {
    ctx.fillText(line, 120, y);
    y += 72;
  }
  return new Uint8Array(canvas.toBuffer('image/png'));
};

const createScannedPdf = async (text: string): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const image = renderTextImage(text);
  const embedded = await pdf.embedPng(image);
  const page = pdf.addPage([612, 792]);
  page.drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });
  return pdf.save();
};

const main = async (): Promise<void> => {
  const runId = randomUUID().slice(0, 8);
  const email = `ocr-pdf-${runId}@example.com`;
  const workspaceName = `OCR PDF ${runId}`;
  const projectSlug = `ocr-pdf-${runId}`;
  const attestationLabel = `ocr-pdf-${runId}`;

  log('building scanned PDF and running OCR locally');
  const pdfBytes = await createScannedPdf(OCR_SOURCE_TEXT);
  const submittedHash = hex(sha256(pdfBytes));
  const pageImages = await renderPdfPages(pdfBytes);
  const ocr = await runOcr(pageImages);
  const normalized = normalizeForShingling(ocr.combinedText);
  const paragraphs = tokenizeNormalized(normalized);
  const tokenCount = paragraphs.reduce(
    (total, paragraph) => total + paragraph.length,
    0,
  );
  const shingles = generateShingles(paragraphs, 'standard');
  if (ocr.summary.ocrPageCount < 1) {
    throw new Error('OCR did not process any pages');
  }
  if (shingles.length === 0) {
    throw new Error('OCR output produced no content proof shingles');
  }

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
    deviceName: `OCR PDF ${runId}`,
    platform: 'darwin',
    appVersion: 'smoke',
  });
  const device: DeviceKey = {
    deviceId: minted.body.device.id,
    privateKey: keypair.privateKey,
  };

  log('creating project', { projectSlug });
  await signedJson<{ project: { id: string; slug: string } }>(
    device,
    'POST',
    `/tenants/${workspace.body.tenant.slug}/projects`,
    {
      slug: projectSlug,
      name: `OCR PDF ${runId}`,
      templateSlug: 'general_provenance',
    },
  );

  log('creating attestation', { attestationLabel });
  const created = await signedJson<{
    attestation: { id: string; state: string };
    attempt: { id: string; state: string };
    tenant: { id: string; slug: string };
    project: { id: string; slug: string };
  }>(
    device,
    'POST',
    `/tenants/${workspace.body.tenant.slug}/projects/${projectSlug}/attestations`,
    { label: attestationLabel },
  );

  const pdfPayloadHash = fromHex(submittedHash);
  const shingleCtx = {
    preset: 'standard' as const,
    sourceExtractionMethod: OCR_V1.sourceExtractionMethod,
  };
  const shingleLeaves = shingles.map((shingle) => ({
    leafType: LEAF_TYPES.shingleSha256V1,
    canonicalPayloadHash: computeShinglePayloadHash(shingle.text, shingleCtx),
    metadata: {
      preset: 'standard',
      source_extraction_method: OCR_V1.sourceExtractionMethod,
      source_index: shingle.sourceIndex,
    },
  }));
  const sourceKey = `src_${Buffer.from(pdfPayloadHash.subarray(0, 8)).toString(
    'hex',
  )}`;
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
        canonicalPayloadHash: pdfPayloadHash,
        metadata: {
          file_name: `ocr-pdf-${runId}.pdf`,
          byte_size: pdfBytes.byteLength,
          hash_source: 'smoke',
        },
      },
      ...shingleLeaves,
    ],
    sourceSummary: {
      file_count: 1,
      shingle_count: shingleLeaves.length,
      ocr_page_count: ocr.summary.ocrPageCount,
    },
    extractionMetadata: {
      [sourceKey]: {
        method: OCR_V1.sourceExtractionMethod,
        engine: ocr.summary.engine,
        engine_version: ocr.summary.engineVersion,
        language_pack: ocr.summary.languagePack,
        language_pack_version: ocr.summary.languagePackVersion,
        page_count: ocr.summary.pageCount,
        ocr_page_count: ocr.summary.ocrPageCount,
        native_text_page_count: 0,
        failed_page_count: ocr.summary.failedPageCount,
        low_confidence_page_count: ocr.summary.lowConfidencePageCount,
        mean_confidence: ocr.summary.meanConfidence,
        paragraph_count: paragraphs.length,
        token_count: tokenCount,
        shingle_count: shingleLeaves.length,
        warnings: ocr.summary.warnings,
      },
    },
    shinglingVersion: '1.0',
    ocrExtractionVersion: OCR_V1.ocrExtractionVersion,
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
    ocrPages: ocr.summary.ocrPageCount,
    shingleCount: shingleLeaves.length,
  });
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

  log('checking receipt OCR coverage');
  const receipt = await signedJson<{
    signatureValid: boolean;
    receipt: {
      leaf_counts: { file: number; shingle: number; component: number };
      extraction_methods?: string[];
    };
  }>(device, 'GET', `/attestations/${created.attestation.id}/receipt`);
  if (!receipt.signatureValid) throw new Error('receipt signature invalid');
  if (receipt.receipt.leaf_counts.file !== 1) {
    throw new Error('receipt did not include one file leaf');
  }
  if (receipt.receipt.leaf_counts.shingle !== shingleLeaves.length) {
    throw new Error(
      `receipt shingle count ${receipt.receipt.leaf_counts.shingle} did not match ${shingleLeaves.length}`,
    );
  }
  if (
    !receipt.receipt.extraction_methods?.includes(OCR_V1.sourceExtractionMethod)
  ) {
    throw new Error('receipt did not include OCR extraction method');
  }

  log('checking verifier pre-lookup metadata');
  const lookup = await sessionJson<{
    attestation: {
      coverageType: string;
      shinglingPresets: string[];
      extractionMethods: string[];
    };
  }>(cookies, 'GET', `/attestations/${created.attestation.id}/lookup`);
  if (!lookup.attestation.coverageType.includes('ocr-derived shingles')) {
    throw new Error(`unexpected coverage type: ${lookup.attestation.coverageType}`);
  }
  if (!lookup.attestation.shinglingPresets.includes('standard')) {
    throw new Error('lookup metadata did not include standard shingling preset');
  }
  if (!lookup.attestation.extractionMethods.includes(OCR_V1.sourceExtractionMethod)) {
    throw new Error('lookup metadata did not include OCR extraction method');
  }

  log('performing OCR content match lookup');
  const matchingCandidateHash = hex(
    computeShinglePayloadHash(shingles[0]!.text, shingleCtx),
  );
  const matchLookup = await sessionJson<{
    package: {
      package_id: string;
      result_type: 'match' | 'no_match';
      submitted_hash: string;
      match?: {
        leaf_type: string;
        source_extraction_method?: string;
      } | null;
    };
    verificationUrl: string;
  }>(cookies, 'POST', `/attestations/${created.attestation.id}/lookup`, {
    submittedHash: 'e'.repeat(64),
    candidateHashes: ['f'.repeat(64), matchingCandidateHash],
  });
  if (matchLookup.package.result_type !== 'match') {
    throw new Error('OCR content lookup did not return a match');
  }
  if (matchLookup.package.submitted_hash !== matchingCandidateHash) {
    throw new Error('OCR lookup did not report the matched candidate hash');
  }
  if (matchLookup.package.match?.leaf_type !== LEAF_TYPES.shingleSha256V1) {
    throw new Error('OCR lookup did not match a shingle leaf');
  }
  if (
    matchLookup.package.match?.source_extraction_method !==
    OCR_V1.sourceExtractionMethod
  ) {
    throw new Error('OCR lookup did not carry OCR source extraction method');
  }
  if (!matchLookup.verificationUrl.startsWith('/v/')) {
    throw new Error('OCR content match did not issue a public verification URL');
  }

  log('checking OCR public verification link');
  const matchVerification = await sessionJson<{
    targetType: string;
    payload: {
      package_id: string;
      result_type: 'match' | 'no_match';
      match?: { source_extraction_method?: string } | null;
    };
  }>(cookies, 'GET', matchLookup.verificationUrl);
  if (matchVerification.targetType !== 'lookup_result') {
    throw new Error('OCR verification link target was not lookup_result');
  }
  if (matchVerification.payload.package_id !== matchLookup.package.package_id) {
    throw new Error('OCR verification link returned the wrong package');
  }
  if (matchVerification.payload.result_type !== 'match') {
    throw new Error('OCR verification link returned the wrong result');
  }
  if (
    matchVerification.payload.match?.source_extraction_method !==
    OCR_V1.sourceExtractionMethod
  ) {
    throw new Error('OCR verification link lost extraction metadata');
  }

  log('performing OCR content no-match lookup');
  const noMatchLookup = await sessionJson<{
    package: {
      result_type: 'match' | 'no_match';
      submitted_hash: string;
    };
    verificationUrl: string;
  }>(cookies, 'POST', `/attestations/${created.attestation.id}/lookup`, {
    submittedHash: 'd'.repeat(64),
    candidateHashes: ['c'.repeat(64), 'b'.repeat(64)],
  });
  if (noMatchLookup.package.result_type !== 'no_match') {
    throw new Error('OCR content lookup did not return a no-match');
  }
  if (noMatchLookup.package.submitted_hash !== 'd'.repeat(64)) {
    throw new Error('OCR no-match did not keep the display submitted hash');
  }
  if (!noMatchLookup.verificationUrl.startsWith('/v/')) {
    throw new Error('OCR no-match did not issue a public verification URL');
  }

  log('confirmed', {
    email,
    tenant: workspace.body.tenant.slug,
    project: projectSlug,
    attestationId: created.attestation.id,
    submittedHash,
    ocrPages: ocr.summary.ocrPageCount,
    shingleCount: shingleLeaves.length,
  });
};

main().catch((err) => {
  console.error('[ocr-pdf:smoke] failed:', err);
  process.exit(1);
});
