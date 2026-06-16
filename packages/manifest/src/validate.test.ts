import { describe, it, expect } from 'vitest';
import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import { buildManifest, type BuildManifestInput } from './build.js';
import type { Manifest } from './types.js';
import {
  validateManifest,
  verifyManifestSignature,
} from './validate.js';

const payloadHash = (n: number): Uint8Array => {
  const b = new Uint8Array(32);
  b[31] = n;
  return b;
};

const baseInput = (): Omit<BuildManifestInput, 'leaves'> => ({
  tenantId: '00000000-0000-0000-0000-000000000000',
  projectId: '11111111-1111-1111-1111-111111111111',
  attestationId: '22222222-2222-2222-2222-222222222222',
  attemptId: '33333333-3333-3333-3333-333333333333',
  createdByUserId: '44444444-4444-4444-4444-444444444444',
  createdByDeviceId: '55555555-5555-5555-5555-555555555555',
  createdByProfileId: '66666666-6666-6666-6666-666666666666',
  sourceSummary: { file_count: 3, shingle_count: 0, ocr_page_count: 0 },
  createdAt: '2026-05-14T00:00:00Z',
});

const validManifest = (): Manifest =>
  buildManifest({
    ...baseInput(),
    leaves: [1, 2, 3].map((n) => ({
      leafType: LEAF_TYPES.fileSha256V1,
      canonicalPayloadHash: payloadHash(n),
    })),
  });

const clone = (m: Manifest): Manifest =>
  JSON.parse(JSON.stringify(m)) as Manifest;

describe('validateManifest — happy path', () => {
  it('accepts a freshly built manifest', () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe('validateManifest — structural failures', () => {
  it('rejects a non-object', () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest('nope').valid).toBe(false);
  });

  it('rejects a missing required field', () => {
    const m = clone(validManifest()) as Partial<Manifest>;
    delete m.tenant_id;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'tenant_id')).toBe(true);
  });

  it('rejects a wrong version field', () => {
    const m = clone(validManifest());
    m.protocol_version = '2.0';
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'protocol_version')).toBe(
      true,
    );
  });

  it('rejects a non-integer source_summary count', () => {
    const m = clone(validManifest());
    (m.source_summary as Record<string, unknown>).file_count = 'three';
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.field === 'source_summary.file_count'),
    ).toBe(true);
  });

  it('rejects a leaf_counts mismatch', () => {
    const m = clone(validManifest());
    m.leaf_counts.file = 99;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'leaf_counts.file')).toBe(
      true,
    );
  });

  it('rejects an unsorted leaf_set', () => {
    const m = clone(validManifest());
    m.leaf_set.reverse();
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'leaf_set')).toBe(true);
  });

  it('rejects malformed signature entries before cryptographic verification', () => {
    const m = clone(validManifest());
    m.signatures = [
      {
        signer_kind: 'device',
        key_id: '',
        algorithm: 'ed25519',
        signature: '',
      },
      {
        signer_kind: 'unknown' as 'device',
        key_id: 'key-1',
        algorithm: 'rsa' as 'ed25519',
        signature: 'abc',
      },
    ];
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'signatures[0].key_id')).toBe(
      true,
    );
    expect(
      result.issues.some((i) => i.field === 'signatures[0].signature'),
    ).toBe(true);
    expect(
      result.issues.some((i) => i.field === 'signatures[1].signer_kind'),
    ).toBe(true);
    expect(
      result.issues.some((i) => i.field === 'signatures[1].algorithm'),
    ).toBe(true);
  });
});

describe('validateManifest — cryptographic recompute', () => {
  it('rejects a tampered merkle_root', () => {
    const m = clone(validManifest());
    m.merkle_root =
      '0000000000000000000000000000000000000000000000000000000000000000';
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'merkle_root')).toBe(true);
  });

  it('rejects a tampered leaf_hash (recompute mismatch)', () => {
    const m = clone(validManifest());
    // Flip the last hex char of the first leaf's hash.
    const lh = m.leaf_set[0]!.leaf_hash;
    m.leaf_set[0]!.leaf_hash =
      lh.slice(0, -1) + (lh.endsWith('0') ? '1' : '0');
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.field === 'leaf_set[0].leaf_hash'),
    ).toBe(true);
  });

  it('rejects a manifest where canonical_payload_hash was swapped out', () => {
    const m = clone(validManifest());
    // Keep leaf_hash, change the payload hash it claims to derive from.
    m.leaf_set[0]!.canonical_payload_hash =
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    // The recompute now disagrees with the (untouched) leaf_hash.
    expect(
      result.issues.some((i) => i.field === 'leaf_set[0].leaf_hash'),
    ).toBe(true);
  });
});

describe('verifyManifestSignature', () => {
  it('verifies a device signature produced over the §8.1 digest', async () => {
    const kp = await generateEd25519Keypair();
    const manifest = validManifest();
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    const signature = await signEd25519(digest, kp.privateKey);
    manifest.signatures = [
      {
        signer_kind: 'device',
        key_id: manifest.created_by_device_id,
        algorithm: 'ed25519',
        signature,
      },
    ];
    expect(
      await verifyManifestSignature(manifest, 'device', kp.publicKey),
    ).toBe(true);
  });

  it('rejects a signature verified against the wrong key', async () => {
    const signer = await generateEd25519Keypair();
    const other = await generateEd25519Keypair();
    const manifest = validManifest();
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    manifest.signatures = [
      {
        signer_kind: 'device',
        key_id: manifest.created_by_device_id,
        algorithm: 'ed25519',
        signature: await signEd25519(digest, signer.privateKey),
      },
    ];
    expect(
      await verifyManifestSignature(manifest, 'device', other.publicKey),
    ).toBe(false);
  });

  it('rejects when the manifest body was altered after signing', async () => {
    const kp = await generateEd25519Keypair();
    const manifest = validManifest();
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    manifest.signatures = [
      {
        signer_kind: 'device',
        key_id: manifest.created_by_device_id,
        algorithm: 'ed25519',
        signature: await signEd25519(digest, kp.privateKey),
      },
    ];
    // Tamper after signing.
    manifest.attestation_id = '99999999-9999-9999-9999-999999999999';
    expect(
      await verifyManifestSignature(manifest, 'device', kp.publicKey),
    ).toBe(false);
  });

  it('returns false when there is no matching signature entry', async () => {
    const kp = await generateEd25519Keypair();
    const manifest = validManifest();
    expect(
      await verifyManifestSignature(manifest, 'device', kp.publicKey),
    ).toBe(false);
  });

  it('rejects when the signature key_id is not the expected resolved key', async () => {
    const kp = await generateEd25519Keypair();
    const manifest = validManifest();
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    manifest.signatures = [
      {
        signer_kind: 'device',
        key_id: 'wrong-device-id',
        algorithm: 'ed25519',
        signature: await signEd25519(digest, kp.privateKey),
      },
    ];
    expect(
      await verifyManifestSignature(
        manifest,
        'device',
        kp.publicKey,
        manifest.created_by_device_id,
      ),
    ).toBe(false);
  });
});
