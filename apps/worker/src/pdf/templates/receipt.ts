// HTML template for the attestation receipt PDF (docs/v1 §18.3).
//
// Brand-aligned per docs/brand/style-guide.md — Inter font, one teal accent,
// no rounded corners, no shadows, sentence case. Inline CSS so Playwright
// renders it with no external resource loads.

import type { AttestationReceipt } from '@proveria/receipt';

import { verificationUrlForLink } from '../../verification-url.js';

export interface ReceiptPdfInput {
  receipt: AttestationReceipt;
  /** Public origin used to build the verification URL printed on the PDF. */
  verificationBaseUrl: string;
  /** The verification link id (vrf_…) for this receipt. */
  linkId: string;
  /** Data URL for the verification QR code (encodes verificationBaseUrl + linkId). */
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

const extractionMethodLabel = (method: string): string => {
  if (method === 'plain-text/v1') return 'Plain text';
  if (method === 'pdf-text-layer/v1') return 'Native PDF text';
  if (method === 'ocr-tesseract/v1') return 'OCR text';
  return method;
};

const componentMethodLabel = (method: string): string => {
  if (method === 'exact-image-sha256/v1') return 'Exact image SHA-256';
  return method;
};

export const renderReceiptHtml = (input: ReceiptPdfInput): string => {
  const { receipt, verificationBaseUrl, linkId, qrDataUrl } = input;
  const verificationUrl = verificationUrlForLink(verificationBaseUrl, linkId);
  const deviceVerified = receipt.device_signature.verified ? 'verified' : 'unverified';
  const hasTextContentProof = receipt.leaf_counts.shingle > 0;
  const hasImageProof = receipt.leaf_counts.component > 0;
  const coverageLine = [
    `${receipt.leaf_counts.file} whole-file hash${receipt.leaf_counts.file === 1 ? '' : 'es'}`,
    ...(hasTextContentProof
      ? [
          `${receipt.leaf_counts.shingle} text content proof hash${receipt.leaf_counts.shingle === 1 ? '' : 'es'}`,
        ]
      : []),
    ...(hasImageProof
      ? [
          `${receipt.leaf_counts.component} exact image proof hash${receipt.leaf_counts.component === 1 ? '' : 'es'}`,
        ]
      : []),
  ].join(' · ');
  const extractionLine =
    receipt.extraction_methods.length > 0
      ? receipt.extraction_methods.map(extractionMethodLabel).join(', ')
      : 'None';
  const componentLine =
    (receipt.component_methods?.length ?? 0) > 0
      ? receipt.component_methods.map(componentMethodLabel).join(', ')
      : 'None';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Proveria — Attestation receipt</title>
<style>
  :root {
    --accent: #0d7c7c;
    --ink: #0a0a0a;
    --ink-2: #404040;
    --ink-3: #737373;
    --border: #e5e5e5;
    --panel: #fafaf9;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 11pt/1.5 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: white;
  }
  .wordmark {
    color: var(--accent);
    font-weight: 600;
    font-size: 13pt;
    letter-spacing: -0.01em;
  }
  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9pt;
    color: var(--ink-3);
    margin: 18mm 0 2mm 0;
  }
  h1 {
    font-size: 22pt;
    font-weight: 500;
    letter-spacing: -0.02em;
    margin: 0 0 4mm 0;
  }
  .sub {
    color: var(--ink-2);
    font-size: 11pt;
    margin: 0 0 8mm 0;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2mm 8mm;
    margin-top: 4mm;
  }
  .row {
    padding: 1.5mm 0;
    border-bottom: 1px solid var(--border);
  }
  .label { color: var(--ink-3); font-size: 9pt; }
  .value { color: var(--ink); font-size: 10pt; margin-top: 0.5mm; word-break: break-all; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9pt; }
  .section {
    margin-top: 8mm;
    border-top: 1px solid var(--border);
    padding-top: 4mm;
  }
  .section h2 {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-3);
    font-weight: 500;
    margin: 0 0 3mm 0;
  }
  .footer {
    margin-top: 10mm;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6mm;
    align-items: center;
    padding-top: 5mm;
    border-top: 1px solid var(--border);
  }
  .qr img { display: block; width: 28mm; height: 28mm; image-rendering: pixelated; }
  .verify-url {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 9pt;
    color: var(--ink-2);
    word-break: break-all;
  }
  .verify-url a { color: var(--accent); text-decoration: none; }
  .pkg {
    margin-top: 1.5mm;
    color: var(--ink-3);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 9pt;
  }
</style>
</head>
<body>
  <div class="wordmark">Proveria</div>
  <div class="eyebrow">Attestation receipt</div>
  <h1>${e(receipt.attestation_label)}</h1>
  <p class="sub">Cryptographic provenance for a committed corpus, issued on confirmation.${hasTextContentProof ? ' This receipt includes text content proof coverage.' : ''}${hasImageProof ? ' This receipt includes exact image proof coverage.' : ''}</p>

  <div class="grid">
    <div class="row">
      <div class="label">Package id</div>
      <div class="value mono">${e(receipt.package_id)}</div>
    </div>
    <div class="row">
      <div class="label">Confirmed</div>
      <div class="value">${e(fmt(receipt.confirmed_at))}</div>
    </div>
    <div class="row">
      <div class="label">Issued</div>
      <div class="value">${e(fmt(receipt.issued_at))}</div>
    </div>
    <div class="row">
      <div class="label">Coverage</div>
      <div class="value">${e(coverageLine)}</div>
    </div>
    <div class="row">
      <div class="label">Text extraction</div>
      <div class="value">${e(extractionLine)}</div>
    </div>
    <div class="row">
      <div class="label">Image proof</div>
      <div class="value">${e(componentLine)}</div>
    </div>
  </div>

  <div class="section">
    <h2>Cryptographic state</h2>
    <div class="grid">
      <div class="row" style="grid-column: span 2;">
        <div class="label">Merkle root</div>
        <div class="value mono">${e(receipt.merkle_root)}</div>
      </div>
      <div class="row" style="grid-column: span 2;">
        <div class="label">Manifest canonical SHA-256</div>
        <div class="value mono">${e(receipt.manifest_canonical_sha256)}</div>
      </div>
      <div class="row">
        <div class="label">Hash algorithm</div>
        <div class="value">${e(receipt.hash_algorithm)}</div>
      </div>
      <div class="row">
        <div class="label">Protocol version</div>
        <div class="value">${e(receipt.protocol_version)}</div>
      </div>
      <div class="row">
        <div class="label">Device signature</div>
        <div class="value">${e(receipt.device_signature.algorithm)} · ${e(deviceVerified)}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="qr"><img src="${e(qrDataUrl)}" alt="Verification QR code" /></div>
    <div>
      <div class="label" style="font-size: 9pt; color: var(--ink-3);">Verify this receipt at</div>
      <div class="verify-url"><a href="${e(verificationUrl)}">${e(verificationUrl)}</a></div>
      <div class="pkg">reference ${e(linkId)}</div>
    </div>
  </div>
</body>
</html>`;
};
