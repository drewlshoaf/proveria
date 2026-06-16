import { describe, expect, it } from 'vitest';

import type { ResultPackage } from '@proveria/proofs';
import type { AttestationReceipt } from '@proveria/receipt';

import { renderReceiptHtml } from './receipt.js';
import { renderResultHtml } from './result.js';

const verifierBaseUrl = 'http://127.0.0.1:3003';
const qrDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4Wk3QAAAABJRU5ErkJggg==';

describe('verification PDF templates', () => {
  it('prints verifier-client links in receipt PDFs', () => {
    const html = renderReceiptHtml({
      receipt: receiptFixture,
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_receipt',
      qrDataUrl,
    });

    expect(html).toContain('http://127.0.0.1:3003/v/vrf_receipt');
    expect(html).not.toContain('http://127.0.0.1:3000/v/vrf_receipt');
  });

  it('prints verifier-client links in result PDFs', () => {
    const html = renderResultHtml({
      pkg: resultFixture,
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_result',
      qrDataUrl,
    });

    expect(html).toContain('http://127.0.0.1:3003/v/vrf_result');
    expect(html).not.toContain('http://127.0.0.1:3000/v/vrf_result');
  });

  it('labels content-proof result PDFs clearly', () => {
    const html = renderResultHtml({
      pkg: {
        ...resultFixture,
        match: {
          ...resultFixture.match!,
          leaf_type: 'shingle/sha256/v1',
        },
      },
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_result',
      qrDataUrl,
    });

    expect(html).toContain('Content match');
    expect(html).toContain('Matched content proof hash');
    expect(html).toContain('Text content proof');
    expect(html).toContain('text content proof hash was present');
    expect(html).not.toContain('passage proof hash');
  });

  it('labels OCR content-proof result PDFs clearly', () => {
    const html = renderResultHtml({
      pkg: {
        ...resultFixture,
        match: {
          ...resultFixture.match!,
          leaf_type: 'shingle/sha256/v1',
          source_extraction_method: 'ocr-tesseract/v1',
          preset: 'standard',
          source_index: 4,
        },
      },
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_result',
      qrDataUrl,
    });

    expect(html).toContain('OCR content match');
    expect(html).toContain('Matched content proof hash');
    expect(html).toContain('OCR text content proof');
    expect(html).toContain('OCR text content proof hash was present');
    expect(html).toContain('OCR text');
  });

  it('labels exact image result PDFs clearly', () => {
    const html = renderResultHtml({
      pkg: {
        ...resultFixture,
        match: {
          ...resultFixture.match!,
          leaf_type: 'component/sha256/v1',
          component_method: 'exact-image-sha256/v1',
          media_type: 'image/png',
        },
      },
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_result',
      qrDataUrl,
    });

    expect(html).toContain('Exact image match');
    expect(html).toContain('Matched exact image proof hash');
    expect(html).toContain('Exact image proof');
    expect(html).toContain('Exact image SHA-256');
    expect(html).toContain('PNG');
  });

  it('labels text content coverage in receipt PDFs', () => {
    const html = renderReceiptHtml({
      receipt: {
        ...receiptFixture,
        leaf_counts: { file: 1, shingle: 23, component: 0 },
        extraction_methods: ['pdf-text-layer/v1'],
      },
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_receipt',
      qrDataUrl,
    });

    expect(html).toContain('23 text content proof hashes');
    expect(html).toContain('Native PDF text');
  });

  it('labels exact image coverage in receipt PDFs', () => {
    const html = renderReceiptHtml({
      receipt: {
        ...receiptFixture,
        leaf_counts: { file: 1, shingle: 0, component: 1 },
        component_methods: ['exact-image-sha256/v1'],
      },
      verificationBaseUrl: `${verifierBaseUrl}/`,
      linkId: 'vrf_receipt',
      qrDataUrl,
    });

    expect(html).toContain('1 exact image proof hash');
    expect(html).toContain('Exact image SHA-256');
    expect(html).toContain('exact image proof coverage');
  });
});

const receiptFixture: AttestationReceipt = {
  receipt_version: '1.0',
  receipt_type: 'attestation',
  package_id: 'pkg_receipt',
  tenant_id: 'tenant_1',
  project_id: 'project_1',
  attestation_id: 'att_1',
  attestation_label: 'Evidence Archive',
  confirmed_attempt_id: 'attempt_1',
  manifest_object_key: 'tenants/tenant_1/projects/project_1/att_1/manifest.json',
  manifest_canonical_sha256: 'a'.repeat(64),
  merkle_root: 'b'.repeat(64),
  leaf_counts: { file: 1, shingle: 0, component: 0 },
  extraction_methods: [],
  component_methods: [],
  hash_algorithm: 'sha256',
  protocol_version: '1.0',
  device_signature: {
    key_id: 'device_1',
    algorithm: 'ed25519',
    verified: true,
  },
  confirmed_at: '2026-05-20T12:00:00.000Z',
  issued_at: '2026-05-20T12:01:00.000Z',
  signatures: [
    {
      signer_kind: 'proveria',
      key_id: 'proveria-dev-platform-key',
      algorithm: 'ed25519',
      signature: 'sig',
    },
  ],
};

const resultFixture: ResultPackage = {
  schema_version: '1.0',
  protocol_version: '1.0',
  canonicalization_version: '1.0',
  merkle_version: '1.0',
  verifier_version: '1.0',
  package_id: 'pkg_result',
  result_type: 'match',
  submitted_hash: 'c'.repeat(64),
  hash_algorithm: 'sha256',
  hash_algorithm_version: '1.0',
  lookup_scope: {
    tenant_id: 'tenant_1',
    project_id: 'project_1',
    attestation_id: 'att_1',
  },
  attestation: {
    label: 'Evidence Archive',
    confirmed_at: '2026-05-20T12:00:00.000Z',
    merkle_root: 'b'.repeat(64),
    protocol_version: '1.0',
  },
  match: {
    leaf_id: 'd'.repeat(64),
    leaf_type: 'file/sha256/v1',
    proof_path: [],
  },
  no_match_statement: null,
  signatures: [
    {
      signer_kind: 'proveria',
      key_id: 'proveria-dev-platform-key',
      algorithm: 'ed25519',
      signature: 'sig',
    },
  ],
  created_at: '2026-05-20T12:02:00.000Z',
};
