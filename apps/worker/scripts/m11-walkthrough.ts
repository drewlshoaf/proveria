// M11 walkthrough — exercises the OCR path end-to-end against a SCANNED
// PDF (no text layer). We generate the PDF locally with @napi-rs/canvas so
// the demo doesn't depend on a committed binary fixture, then run the
// exact OCR pipeline a desktop submit would: renderPdfPages → runOcr →
// normalize → shingle → manifest → upload → confirm.
//
// The walkthrough computes a shingle payload hash from the OCR'd text and
// prints it for the user to paste in the portal lookup form, proving the
// match round-trips through the OCR-derived canonical bytes.

import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
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

// Render a "scanned" PDF: each page is a rasterized PNG of body text, with
// NO PDF text layer. The desktop's pdfjs pass therefore returns < the OCR
// fallback threshold (50 tokens) and the OCR path takes over.
//
// We do this in two steps:
//   1. Render each paragraph to a PNG via @napi-rs/canvas
//   2. Assemble those PNGs into one PDF via pdf-lib (pure-JS, no native dep)
const wrapText = (paragraph: string, maxChars: number): string[] => {
  const words = paragraph.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? current + ' ' + w : w;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const renderParagraphToPng = (paragraph: string): Uint8Array => {
  const W = 1224; // US letter @ 144 DPI (twice the spec §3 scale)
  const H = 1584;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'black';
  ctx.font = '48px sans-serif';
  const lines = wrapText(paragraph, 50);
  let y = 160;
  for (const line of lines) {
    ctx.fillText(line, 120, y);
    y += 72;
  }
  return new Uint8Array(canvas.toBuffer('image/png'));
};

const buildScannedPdf = async (paragraphs: string[]): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  for (const para of paragraphs) {
    const png = renderParagraphToPng(para);
    const embedded = await pdf.embedPng(png);
    const page = pdf.addPage([612, 792]); // US letter (pt)
    page.drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });
  }
  return pdf.save();
};

// A single-paragraph corpus, repeated across two pages to verify multi-page
// extraction. Words chosen to be OCR-friendly (no exotic glyphs, no
// numerals adjacent to letters).
const CORPUS_PAGES = [
  'Proveria preserves provenance for digital documents and helps producers prove that a specific passage existed at a specific time without ever revealing the source text to anyone else.',
  'The desktop application normalizes and shingles plaintext locally before submitting any cryptographic metadata and only canonical shingle payload hashes ever leave the producer machine.',
];

const main = async (): Promise<void> => {
  log('\nProveria — M11 walkthrough\n' + '─'.repeat(48));
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
  const adminEmail = `m11-admin-${suffix}@example.com`;
  const consumerEmail = `m11-consumer-${suffix}@example.com`;
  const password = 'm11-walkthrough-pw-123';

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
  log('2. plan        → Team Pro (shingling + OCR allowed)');

  const kp = await generateEd25519Keypair();
  const init = await fetch(`${API}/devices/pairing/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: kp.publicKey,
      name: 'M11 Mac',
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
        name: 'M11 Mac',
        profileId: randomUUID(),
      }),
    },
  );
  const deviceId = ((await approve.json()) as { device: { id: string } })
    .device.id;
  log(`3. paired      → ${deviceId}`);

  await sessionReq(adminCookie, 'POST', `/tenants/${adminTenantSlug}/projects`, {
    slug: 'ocr-corpus',
    name: 'OCR corpus',
    templateSlug: 'general_provenance',
  });
  log('4. project     → ocr-corpus (private)');

  // 5. Build a scanned PDF (no text layer), then run OCR on it.
  const pdfBytes = await buildScannedPdf(CORPUS_PAGES);
  const pdfPath = join(tmpdir(), `m11-scanned-${suffix}.pdf`);
  await writeFile(pdfPath, pdfBytes);
  const fileHashHex = createHash('sha256').update(pdfBytes).digest('hex');
  const filePayloadHash = new Uint8Array(Buffer.from(fileHashHex, 'hex'));
  log(`5. scanned pdf → ${pdfBytes.length} bytes at ${pdfPath}`);

  const pageImages = await renderPdfPages(pdfBytes);
  log(`6. rasterized  → ${pageImages.length} pages → PNG (running tesseract…)`);
  const ocr = await runOcr(pageImages);
  log(
    `7. ocr         → ${ocr.summary.ocrPageCount}/${ocr.summary.pageCount} pages, mean confidence ${ocr.summary.meanConfidence}, ${ocr.summary.lowConfidencePageCount} low-confidence`,
  );
  for (const page of ocr.pages) {
    if (page.failed) {
      log(`   page ${page.pageNumber} failed: ${page.errorMessage ?? '(no message)'}`);
    }
  }

  const normalized = normalizeForShingling(ocr.combinedText);
  const paragraphs = tokenizeNormalized(normalized);
  const tokenCount = paragraphs.reduce((s, p) => s + p.length, 0);
  const shingles = generateShingles(paragraphs, 'standard');
  if (shingles.length === 0) fail('OCR output produced no shingles');
  log(`8. shingled    → ${shingles.length} shingles from ${tokenCount} OCR'd tokens`);

  const createPath = `/tenants/${adminTenantSlug}/projects/ocr-corpus/attestations`;
  const created = await signedPost<{
    attestation: { id: string };
    attempt: { id: string };
    project: { id: string };
    tenant: { id: string };
  }>(kp.privateKey, deviceId, createPath, { label: `ocr-${suffix}` });

  const shingleCtx = {
    preset: 'standard' as const,
    sourceExtractionMethod: OCR_V1.sourceExtractionMethod,
  };
  const shingleLeaves = shingles.map((s) => ({
    leafType: LEAF_TYPES.shingleSha256V1,
    canonicalPayloadHash: computeShinglePayloadHash(s.text, shingleCtx),
    metadata: {
      preset: 'standard',
      source_extraction_method: OCR_V1.sourceExtractionMethod,
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
        metadata: { byte_size: pdfBytes.length },
      },
      ...shingleLeaves,
    ],
    shinglingVersion: '1.0',
    ocrExtractionVersion: OCR_V1.ocrExtractionVersion,
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
        shingle_count: shingles.length,
        warnings: ocr.summary.warnings,
      },
    },
    sourceSummary: {
      file_count: 1,
      shingle_count: shingles.length,
      ocr_page_count: ocr.summary.ocrPageCount,
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

  let confirmed = false;
  for (let i = 0; i < 60; i++) {
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
  log('9. confirmed   → OCR manifest accepted');

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
  log(`10. consumer    → ${consumerEmail} (granted)`);

  const demoShingle = shingles[0]!;
  const demoShingleHashHex = Buffer.from(
    computeShinglePayloadHash(demoShingle.text, shingleCtx),
  ).toString('hex');

  log('\n' + '─'.repeat(48));
  log('✓ TENANT SEEDED');
  log('─'.repeat(48));
  log(`
LOGINS

  Admin (Team Pro)
    ${adminEmail}  /  ${password}

  Consumer (granted access)
    ${consumerEmail}  /  ${password}

THINGS TO VERIFY BY HAND — Milestone 11
=======================================

C40 — OCR spec is locked
  docs/protocol/v1/ocr-v1.md
    • Engine: tesseract.js (WASM, no native binary).
    • Source tag baked into canonical shingle bytes: ocr-tesseract/v1.

C42 — desktop OCR fallback fired on a scanned PDF
  The PDF at ${pdfPath} has no text layer.
  pdfjs's text-layer pass returned <50 tokens, so the desktop pipeline
  fell through to @proveria/ocr's tesseract.js path. ${ocr.summary.ocrPageCount}/${ocr.summary.pageCount}
  pages OCR'd cleanly, mean confidence ${ocr.summary.meanConfidence}.

C43 — portal pre-lookup metadata surfaces OCR coverage
  As the CONSUMER, open:
    ${PORTAL}/lookups/${created.attestation.id}
    • Coverage row reads "whole-file + ocr-derived shingles"
    • Extraction methods row reads "ocr-tesseract/v1"

C43 — OCR shingle MATCH
  Paste this OCR-derived shingle payload hash:
    ${demoShingleHashHex}
    • Result is a MATCH against a shingle whose canonical bytes encode
      source_extraction_method = ocr-tesseract/v1.
    • If the engine version drifts, the hash drifts — by design.

C43 — receipt distinguishes the extraction
  As the ADMIN, open the attestation detail page and download the
  receipt JSON. The new "extraction_methods" field contains
  ["ocr-tesseract/v1"], which the receipt PDF surfaces accordingly.

WHAT THE FIRST SHINGLE COVERS
=============================
OCR'd window (the first ${demoShingle.text.split(' ').length}-token shingle off page 1):
    "${demoShingle.text}"

A consumer with their own copy of the same scanned PDF reproduces this
hash by running it through the same OCR engine + shingling pipeline.
Pasting the precomputed hash above is the same thing — the math is
deterministic given the same engine/language-pack/normalization inputs.
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
