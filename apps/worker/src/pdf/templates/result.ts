// HTML template for a lookup result-package PDF (docs/v1 §18.3).
// Brand-aligned, inline CSS — same approach as receipt.ts.

import type { ResultPackage } from '@proveria/proofs';

import { verificationUrlForLink } from '../../verification-url.js';

export interface ResultPdfInput {
  pkg: ResultPackage;
  verificationBaseUrl: string;
  linkId: string;
  qrDataUrl: string;
}

const e = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmt = (iso: string): string => {
  try {
    return new Date(iso).toUTCString().replace('GMT', 'UTC');
  } catch {
    return iso;
  }
};

const isContentMatch = (pkg: ResultPackage): boolean =>
  pkg.result_type === 'match' && pkg.match?.leaf_type === 'shingle/sha256/v1';

const isOcrContentMatch = (pkg: ResultPackage): boolean =>
  isContentMatch(pkg) &&
  pkg.match?.source_extraction_method === 'ocr-tesseract/v1';

const isExactImageMatch = (pkg: ResultPackage): boolean =>
  pkg.result_type === 'match' &&
  pkg.match?.leaf_type === 'component/sha256/v1' &&
  pkg.match?.component_method === 'exact-image-sha256/v1';

const leafTypeLabel = (leafType: string): string => {
  if (leafType === 'file/sha256/v1') return 'Whole-file SHA-256';
  if (leafType === 'shingle/sha256/v1') return 'Text content proof';
  if (leafType === 'component/sha256/v1') return 'Component proof';
  return leafType;
};

const extractionMethodLabel = (method: string): string => {
  if (method === 'plain-text/v1') return 'Plain text';
  if (method === 'pdf-text-layer/v1') return 'Native PDF text';
  if (method === 'ocr-tesseract/v1') return 'OCR text';
  return method;
};

const matchProofLabel = (pkg: ResultPackage): string => {
  if (pkg.match?.source_extraction_method === 'ocr-tesseract/v1') {
    return 'OCR text content proof';
  }
  if (pkg.match?.component_method === 'exact-image-sha256/v1') {
    return 'Exact image proof';
  }
  return pkg.match ? leafTypeLabel(pkg.match.leaf_type) : '';
};

const componentMethodLabel = (method: string): string => {
  if (method === 'exact-image-sha256/v1') return 'Exact image SHA-256';
  return method;
};

const imageMediaTypeLabel = (mediaType: string): string => {
  if (mediaType === 'image/png') return 'PNG';
  if (mediaType === 'image/jpeg') return 'JPEG';
  return mediaType;
};

export const renderResultHtml = (input: ResultPdfInput): string => {
  const { pkg, verificationBaseUrl, linkId, qrDataUrl } = input;
  const verificationUrl = verificationUrlForLink(verificationBaseUrl, linkId);
  const isMatch = pkg.result_type === 'match';
  const contentMatch = isContentMatch(pkg);
  const ocrContentMatch = isOcrContentMatch(pkg);
  const exactImageMatch = isExactImageMatch(pkg);
  const headline = isMatch
    ? ocrContentMatch
      ? 'OCR content match'
      : exactImageMatch
        ? 'Exact image match'
      : contentMatch
        ? 'Content match'
      : 'Whole-file match'
    : 'No match';
  const submittedHashLabel = contentMatch
    ? 'Matched content proof hash'
    : exactImageMatch
      ? 'Matched exact image proof hash'
    : 'Submitted hash';
  const resultMeaning = isMatch
    ? ocrContentMatch
      ? 'At least one locally generated OCR text content proof hash was present in this attestation. The source passage itself is not included in this package.'
      : exactImageMatch
        ? 'The locally generated exact image SHA-256 proof hash was present in this attestation.'
      : contentMatch
        ? 'At least one locally generated text content proof hash was present in this attestation. The source passage itself is not included in this package.'
      : 'The submitted whole-file SHA-256 was present in this attestation.'
    : 'The submitted hash was not found in this specific attestation at lookup time.';
  const matchSection = isMatch && pkg.match
    ? `
  <div class="section">
    <h2>Membership proof</h2>
    <p class="hint">${e(resultMeaning)}</p>
    <div class="grid">
      <div class="row" style="grid-column: span 2;">
        <div class="label">Leaf id</div>
        <div class="value mono">${e(pkg.match.leaf_id)}</div>
      </div>
      <div class="row">
        <div class="label">Proof type</div>
        <div class="value">${e(matchProofLabel(pkg))}</div>
      </div>
      ${
        pkg.match.source_extraction_method
          ? `<div class="row">
        <div class="label">Extraction method</div>
        <div class="value">${e(extractionMethodLabel(pkg.match.source_extraction_method))}</div>
      </div>`
          : ''
      }
      ${
        pkg.match.component_method
          ? `<div class="row">
        <div class="label">Image proof</div>
        <div class="value">${e(componentMethodLabel(pkg.match.component_method))}</div>
      </div>`
          : ''
      }
      ${
        pkg.match.media_type
          ? `<div class="row">
        <div class="label">Image format</div>
        <div class="value">${e(imageMediaTypeLabel(pkg.match.media_type))}</div>
      </div>`
          : ''
      }
      <div class="row">
        <div class="label">Proof depth</div>
        <div class="value">${pkg.match.proof_path.length} step${pkg.match.proof_path.length === 1 ? '' : 's'} from leaf to root</div>
      </div>
    </div>
  </div>`
    : '';
  const noMatchSection = !isMatch && pkg.no_match_statement
    ? `
  <div class="section">
    <h2>Statement</h2>
    <p style="font-style: italic; margin-top: 2mm;">&ldquo;${e(pkg.no_match_statement)}&rdquo;</p>
    <p class="hint">Non-membership in this specific attestation only — never universal absence.</p>
  </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Proveria — Verification result</title>
<style>
  :root {
    --accent: #0d7c7c;
    --ink: #0a0a0a;
    --ink-2: #404040;
    --ink-3: #737373;
    --border: #e5e5e5;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 11pt/1.5 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink);
  }
  .wordmark { color: var(--accent); font-weight: 600; font-size: 13pt; letter-spacing: -0.01em; }
  .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 9pt; color: var(--ink-3); margin: 18mm 0 2mm 0; }
  h1 { font-size: 22pt; font-weight: 500; letter-spacing: -0.02em; margin: 0 0 4mm 0; }
  .sub { color: var(--ink-2); font-size: 11pt; margin: 0 0 8mm 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; margin-top: 4mm; }
  .row { padding: 1.5mm 0; border-bottom: 1px solid var(--border); }
  .label { color: var(--ink-3); font-size: 9pt; }
  .value { color: var(--ink); font-size: 10pt; margin-top: 0.5mm; word-break: break-all; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9pt; }
  .section { margin-top: 8mm; border-top: 1px solid var(--border); padding-top: 4mm; }
  .section h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); font-weight: 500; margin: 0 0 3mm 0; }
  .hint { color: var(--ink-3); font-size: 9pt; margin: 2mm 0 0 0; }
  .footer { margin-top: 10mm; display: grid; grid-template-columns: auto 1fr; gap: 6mm; align-items: center; padding-top: 5mm; border-top: 1px solid var(--border); }
  .qr img { display: block; width: 28mm; height: 28mm; image-rendering: pixelated; }
  .verify-url { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9pt; color: var(--ink-2); word-break: break-all; }
  .verify-url a { color: var(--accent); text-decoration: none; }
  .pkg { margin-top: 1.5mm; color: var(--ink-3); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9pt; }
</style>
</head>
<body>
  <div class="wordmark">Proveria</div>
  <div class="eyebrow">Verification result</div>
  <h1>${headline}</h1>
  <p class="sub">for attestation <strong>${e(pkg.attestation.label)}</strong>${pkg.attestation.confirmed_at ? `, confirmed ${e(fmt(pkg.attestation.confirmed_at))}` : ''}.</p>
  <p class="sub">${e(resultMeaning)}</p>

  <div class="grid">
    <div class="row" style="grid-column: span 2;">
      <div class="label">${e(submittedHashLabel)} (${e(pkg.hash_algorithm)})</div>
      <div class="value mono">${e(pkg.submitted_hash)}</div>
    </div>
    <div class="row" style="grid-column: span 2;">
      <div class="label">Merkle root</div>
      <div class="value mono">${e(pkg.attestation.merkle_root)}</div>
    </div>
    <div class="row">
      <div class="label">Package id</div>
      <div class="value mono">${e(pkg.package_id)}</div>
    </div>
    <div class="row">
      <div class="label">Result issued</div>
      <div class="value">${e(fmt(pkg.created_at))}</div>
    </div>
    <div class="row">
      <div class="label">Protocol version</div>
      <div class="value">${e(pkg.protocol_version)}</div>
    </div>
  </div>
  ${matchSection}
  ${noMatchSection}

  <div class="footer">
    <div class="qr"><img src="${e(qrDataUrl)}" alt="Verification QR code" /></div>
    <div>
      <div class="label" style="color: var(--ink-3);">Verify this result at</div>
      <div class="verify-url"><a href="${e(verificationUrl)}">${e(verificationUrl)}</a></div>
      <div class="pkg">reference ${e(linkId)}</div>
    </div>
  </div>
</body>
</html>`;
};
