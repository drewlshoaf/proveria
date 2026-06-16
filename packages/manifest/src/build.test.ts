import { describe, it, expect } from 'vitest';
import { computeMerkleRoot, LEAF_TYPES } from '@proveria/crypto-core';
import { buildManifest, type BuildManifestInput } from './build.js';

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
  sourceSummary: { file_count: 1, shingle_count: 0, ocr_page_count: 0 },
  createdAt: '2026-05-14T00:00:00Z',
});

describe('buildManifest', () => {
  it('builds a single-file manifest with V1 version fields and empty signatures', () => {
    const m = buildManifest({
      ...baseInput(),
      leaves: [
        { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
      ],
    });
    expect(m.schema_version).toBe('1.0');
    expect(m.protocol_version).toBe('1.0');
    expect(m.hash_algorithm).toBe('sha256');
    expect(m.signatures).toEqual([]);
    expect(m.leaf_set).toHaveLength(1);
    expect(m.leaf_set[0]?.leaf_type).toBe('file/sha256/v1');
    expect(m.leaf_set[0]?.leaf_hash).toMatch(/^[0-9a-f]{64}$/);
    // Single-leaf tree: root equals the leaf hash.
    expect(m.merkle_root).toBe(m.leaf_set[0]?.leaf_hash);
    expect(m.leaf_counts).toEqual({ file: 1, shingle: 0, component: 0 });
  });

  it('sorts leaf_set by leaf_hash regardless of input order', () => {
    const leaves = [5, 1, 9, 3].map((n) => ({
      leafType: LEAF_TYPES.fileSha256V1,
      canonicalPayloadHash: payloadHash(n),
    }));
    const m = buildManifest({ ...baseInput(), leaves });
    const hashes = m.leaf_set.map((l) => l.leaf_hash);
    const sorted = [...hashes].sort();
    expect(hashes).toEqual(sorted);
  });

  it('merkle_root recomputes from the sorted leaf set', () => {
    const leaves = [1, 2, 3].map((n) => ({
      leafType: LEAF_TYPES.fileSha256V1,
      canonicalPayloadHash: payloadHash(n),
    }));
    const m = buildManifest({ ...baseInput(), leaves });
    const recomputed = Buffer.from(
      computeMerkleRoot(
        m.leaf_set.map((l) => new Uint8Array(Buffer.from(l.leaf_hash, 'hex'))),
      ),
    ).toString('hex');
    expect(m.merkle_root).toBe(recomputed);
  });

  it('tallies leaf_counts across mixed leaf types', () => {
    const m = buildManifest({
      ...baseInput(),
      leaves: [
        { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
        { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(2) },
        { leafType: LEAF_TYPES.shingleSha256V1, canonicalPayloadHash: payloadHash(3) },
        { leafType: LEAF_TYPES.componentSha256V1, canonicalPayloadHash: payloadHash(4) },
      ],
    });
    expect(m.leaf_counts).toEqual({ file: 2, shingle: 1, component: 1 });
  });

  it('throws when given zero leaves', () => {
    expect(() => buildManifest({ ...baseInput(), leaves: [] })).toThrow(
      /zero leaves/,
    );
  });

  it('throws when two leaves of the same type share a payload hash (duplicate leaf_hash)', () => {
    expect(() =>
      buildManifest({
        ...baseInput(),
        leaves: [
          { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(7) },
          { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(7) },
        ],
      }),
    ).toThrow('duplicate_leaf_hash');
  });

  it('honors shingling + ocr version overrides and template id', () => {
    const m = buildManifest({
      ...baseInput(),
      templateId: 'research_dataset',
      shinglingVersion: '1.0',
      ocrExtractionVersion: '1.0',
      leaves: [
        { leafType: LEAF_TYPES.shingleSha256V1, canonicalPayloadHash: payloadHash(1) },
      ],
    });
    expect(m.template_id).toBe('research_dataset');
    expect(m.shingling_version).toBe('1.0');
    expect(m.ocr_extraction_version).toBe('1.0');
  });
});
