import { describe, it, expect } from 'vitest';
import {
  buildMerkleProof,
  computeMerkleRoot,
  sortAndValidateLeaves,
  verifyMerkleProof,
  type MerkleProofStep,
} from './merkle.js';
import { hex, loadVectorFile, unhex } from './test-vectors.js';

interface MerkleTreeVectorFile {
  vectors: Array<{
    name: string;
    input: { leafHashesHex: string[] };
    expected: {
      sortedLeafHashesHex?: string[];
      merkleRootHex: string | null;
      error?: string;
    };
  }>;
}

interface MerkleProofVectorFile {
  vectors: Array<{
    name: string;
    input: { leafHashesHex: string[]; targetLeafHashHex: string };
    expected: {
      proofPath: Array<{ sibling: string; position: 'left' | 'right' }>;
      merkleRootHex: string;
    };
  }>;
}

const treeFile = loadVectorFile<MerkleTreeVectorFile>('merkle-tree');
const proofFile = loadVectorFile<MerkleProofVectorFile>('merkle-proof');

describe('merkle-tree — spec vectors', () => {
  for (const v of treeFile.vectors) {
    it(v.name, () => {
      const leaves = v.input.leafHashesHex.map(unhex);
      if (v.expected.error) {
        expect(() => computeMerkleRoot(leaves)).toThrow(v.expected.error);
        return;
      }
      const root = computeMerkleRoot(leaves);
      expect(hex(root)).toBe(v.expected.merkleRootHex);
      if (v.expected.sortedLeafHashesHex) {
        expect(sortAndValidateLeaves(leaves).map(hex)).toEqual(
          v.expected.sortedLeafHashesHex,
        );
      }
    });
  }
});

describe('merkle-proof — spec vectors', () => {
  for (const v of proofFile.vectors) {
    it(v.name, () => {
      const leaves = v.input.leafHashesHex.map(unhex);
      const target = unhex(v.input.targetLeafHashHex);
      const proof = buildMerkleProof(leaves, target);

      // Proof shape matches the vector.
      expect(
        proof.map((s) => ({ sibling: hex(s.sibling), position: s.position })),
      ).toEqual(v.expected.proofPath);

      // And it verifies against the recorded root.
      const root = unhex(v.expected.merkleRootHex);
      expect(verifyMerkleProof(target, proof, root)).toBe(true);
    });
  }
});

describe('merkle — behavior', () => {
  const leaf = (n: number): Uint8Array => {
    const b = new Uint8Array(32);
    b[31] = n;
    return b;
  };

  it('single-leaf tree root equals the leaf', () => {
    const l = leaf(7);
    expect(hex(computeMerkleRoot([l]))).toBe(hex(l));
  });

  it('empty leaf set throws', () => {
    expect(() => computeMerkleRoot([])).toThrow('empty_leaf_set');
  });

  it('duplicate leaves throw', () => {
    expect(() => computeMerkleRoot([leaf(1), leaf(1)])).toThrow(
      'duplicate_leaf_hash',
    );
  });

  it('input order does not affect the root', () => {
    const a = computeMerkleRoot([leaf(3), leaf(1), leaf(2)]);
    const b = computeMerkleRoot([leaf(1), leaf(2), leaf(3)]);
    expect(hex(a)).toBe(hex(b));
  });

  it('round-trips a proof for every leaf in a 5-leaf tree', () => {
    const leaves = [leaf(10), leaf(20), leaf(30), leaf(40), leaf(50)];
    const root = computeMerkleRoot(leaves);
    for (const target of leaves) {
      const proof = buildMerkleProof(leaves, target);
      expect(verifyMerkleProof(target, proof, root)).toBe(true);
    }
  });

  it('a tampered proof fails verification', () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    const root = computeMerkleRoot(leaves);
    const proof = buildMerkleProof(leaves, leaf(1));
    const tampered: MerkleProofStep[] = proof.map((s, i) =>
      i === 0 ? { sibling: leaf(99), position: s.position } : s,
    );
    expect(verifyMerkleProof(leaf(1), tampered, root)).toBe(false);
  });

  it('buildMerkleProof throws for a leaf not in the set', () => {
    expect(() =>
      buildMerkleProof([leaf(1), leaf(2)], leaf(99)),
    ).toThrow('target_not_in_leaf_set');
  });
});
