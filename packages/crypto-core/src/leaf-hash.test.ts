import { describe, it, expect } from 'vitest';
import {
  buildLeafHashInput,
  computeLeafHash,
  isLeafType,
  LEAF_TYPES,
  type LeafType,
} from './leaf-hash.js';
import { hex, loadVectorFile, unhex } from './test-vectors.js';

interface LeafHashVectorFile {
  vectors: Array<{
    name: string;
    input: {
      protocolVersion: string;
      leafType: string;
      hashAlgorithm: string;
      payloadHex: string;
    };
    expected: {
      payloadHashHex: string;
      leafHashInputLengthBytes: number;
      leafHashInputHex: string;
      leafHashHex: string;
    };
  }>;
}

const file = loadVectorFile<LeafHashVectorFile>('leaf-hash');

describe('leaf-hash — spec vectors', () => {
  for (const v of file.vectors) {
    it(v.name, () => {
      const input = {
        protocolVersion: v.input.protocolVersion,
        leafType: v.input.leafType as LeafType,
        hashAlgorithm: v.input.hashAlgorithm,
        canonicalPayloadHash: unhex(v.expected.payloadHashHex),
      };
      const leafHashInput = buildLeafHashInput(input);
      expect(leafHashInput.length).toBe(
        v.expected.leafHashInputLengthBytes,
      );
      expect(hex(leafHashInput)).toBe(v.expected.leafHashInputHex);
      expect(hex(computeLeafHash(input))).toBe(v.expected.leafHashHex);
    });
  }
});

describe('leaf-hash — behavior', () => {
  const goodPayloadHash = unhex(
    '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
  );

  it('rejects a payload hash that is not 32 bytes', () => {
    expect(() =>
      buildLeafHashInput({
        protocolVersion: '1.0',
        leafType: LEAF_TYPES.fileSha256V1,
        hashAlgorithm: 'sha256',
        canonicalPayloadHash: new Uint8Array(31),
      }),
    ).toThrow(/32 bytes/);
  });

  it('rejects an unknown leaf type', () => {
    expect(() =>
      buildLeafHashInput({
        protocolVersion: '1.0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        leafType: 'bogus/sha256/v1' as any,
        hashAlgorithm: 'sha256',
        canonicalPayloadHash: goodPayloadHash,
      }),
    ).toThrow(/unknown leaf_type/);
  });

  it('isLeafType guards the registry', () => {
    expect(isLeafType('file/sha256/v1')).toBe(true);
    expect(isLeafType('shingle/sha256/v1')).toBe(true);
    expect(isLeafType('component/sha256/v1')).toBe(true);
    expect(isLeafType('file/sha256/v2')).toBe(false);
    expect(isLeafType('nonsense')).toBe(false);
  });

  it('different leaf types over the same payload produce different leaf hashes', () => {
    const fileLeaf = computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.fileSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: goodPayloadHash,
    });
    const shingleLeaf = computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.shingleSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: goodPayloadHash,
    });
    expect(hex(fileLeaf)).not.toBe(hex(shingleLeaf));
  });
});
