import { describe, it, expect } from 'vitest';

import { buildAttestationReceipt, type BuildAttestationReceiptInput } from './build.js';

const sampleInput = (): BuildAttestationReceiptInput => ({
  packageId: 'pkg_01HZX8R3K9',
  tenantId: '11111111-1111-1111-1111-111111111111',
  projectId: '22222222-2222-2222-2222-222222222222',
  attestationId: '33333333-3333-3333-3333-333333333333',
  attestationLabel: 'draft-2026-q2',
  confirmedAttemptId: '44444444-4444-4444-4444-444444444444',
  manifestObjectKey:
    'tenants/11111111-1111-1111-1111-111111111111/projects/22222222-2222-2222-2222-222222222222/attestations/33333333-3333-3333-3333-333333333333/attempts/44444444-4444-4444-4444-444444444444/manifest.json',
  manifestCanonicalSha256:
    'c0a9acf68a3b0a044bdc477d1e66048d458f4a42482418831dbdcdb2106a90fd',
  merkleRoot:
    '12eef88597c4a1c220556988077012d592b737c19410afee0dc11bf8aa922723',
  leafCounts: { file: 2, shingle: 0, component: 0 },
  hashAlgorithm: 'sha256',
  protocolVersion: '1.0',
  deviceSignature: {
    key_id: '55555555-5555-5555-5555-555555555555',
    algorithm: 'ed25519',
    verified: true,
  },
  confirmedAt: '2026-05-14T12:00:00.000Z',
  issuedAt: '2026-05-14T12:00:01.000Z',
});

describe('buildAttestationReceipt', () => {
  it('assembles a V1 receipt with fixed schema fields and no signatures', () => {
    const receipt = buildAttestationReceipt(sampleInput());
    expect(receipt.receipt_version).toBe('1.0');
    expect(receipt.receipt_type).toBe('attestation');
    expect(receipt.signatures).toEqual([]);
  });

  it('carries every input through to the receipt body', () => {
    const input = sampleInput();
    const receipt = buildAttestationReceipt(input);
    expect(receipt.package_id).toBe(input.packageId);
    expect(receipt.tenant_id).toBe(input.tenantId);
    expect(receipt.attestation_id).toBe(input.attestationId);
    expect(receipt.attestation_label).toBe(input.attestationLabel);
    expect(receipt.confirmed_attempt_id).toBe(input.confirmedAttemptId);
    expect(receipt.manifest_object_key).toBe(input.manifestObjectKey);
    expect(receipt.manifest_canonical_sha256).toBe(
      input.manifestCanonicalSha256,
    );
    expect(receipt.merkle_root).toBe(input.merkleRoot);
    expect(receipt.leaf_counts).toEqual(input.leafCounts);
    expect(receipt.component_methods).toEqual([]);
    expect(receipt.device_signature).toEqual(input.deviceSignature);
    expect(receipt.confirmed_at).toBe(input.confirmedAt);
    expect(receipt.issued_at).toBe(input.issuedAt);
  });
});
