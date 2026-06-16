// Protocol V1 §6 — Merkle tree construction + proof.
//
// Leaves sort lexicographically by their raw 32-byte hash. Duplicates are
// rejected (§6.4). Empty leaf sets are rejected (§6.6). A single-leaf tree's
// root is the leaf itself.
//
// Internal node hash input (§6.3):
//   0x01 || left_child_hash || right_child_hash      (65 bytes total)
//   node_hash = SHA-256(node_hash_input)
//
// Odd-leaf rule (§6.5): the final unpaired node at a level is promoted up to
// the next level unchanged. Proofs for promoted nodes emit no entry for the
// promoted-through level (sparse proofs).

import { createHash } from 'node:crypto';

export interface MerkleProofStep {
  /** The sibling node's 32-byte hash. */
  sibling: Uint8Array;
  /** Where the sibling sits relative to the current node. */
  position: 'left' | 'right';
}

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest());

/** Lexicographic compare of two byte arrays. */
const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i += 1) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai !== bi) return ai - bi;
  }
  return a.length - b.length;
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && compareBytes(a, b) === 0;

/** SHA-256 of `0x01 || left || right`. */
const hashInternalNode = (
  left: Uint8Array,
  right: Uint8Array,
): Uint8Array => {
  if (left.length !== 32 || right.length !== 32) {
    throw new Error('internal-node children must be 32 bytes');
  }
  const buf = new Uint8Array(65);
  buf[0] = 0x01;
  buf.set(left, 1);
  buf.set(right, 33);
  return sha256(buf);
};

const validateAndSort = (leafHashes: Uint8Array[]): Uint8Array[] => {
  if (leafHashes.length === 0) {
    throw new Error('empty_leaf_set');
  }
  for (const h of leafHashes) {
    if (h.length !== 32) {
      throw new Error(`leaf hash must be 32 bytes (got ${h.length})`);
    }
  }
  const sorted = leafHashes.slice().sort(compareBytes);
  for (let i = 1; i < sorted.length; i += 1) {
    if (bytesEqual(sorted[i - 1]!, sorted[i]!)) {
      throw new Error('duplicate_leaf_hash');
    }
  }
  return sorted;
};

const buildNextLevel = (level: Uint8Array[]): Uint8Array[] => {
  const next: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2) {
    if (i + 1 < level.length) {
      next.push(hashInternalNode(level[i]!, level[i + 1]!));
    } else {
      // Odd-leaf promotion (§6.5): carry up unchanged.
      next.push(level[i]!);
    }
  }
  return next;
};

/** Sort + dedupe leaf hashes and return them in canonical order (§6.2). */
export const sortAndValidateLeaves = (
  leafHashes: Uint8Array[],
): Uint8Array[] => validateAndSort(leafHashes);

/** Compute the Merkle root of an unordered set of leaf hashes. */
export const computeMerkleRoot = (
  leafHashes: Uint8Array[],
): Uint8Array => {
  let level = validateAndSort(leafHashes);
  while (level.length > 1) {
    level = buildNextLevel(level);
  }
  return level[0]!;
};

/**
 * Build a Merkle proof for `targetLeafHash`. Sparse: omits a step for each
 * level the target was promoted through. Throws if the target is not in the
 * leaf set, or if the input set is empty / has duplicates.
 */
export const buildMerkleProof = (
  leafHashes: Uint8Array[],
  targetLeafHash: Uint8Array,
): MerkleProofStep[] => {
  if (targetLeafHash.length !== 32) {
    throw new Error('target leaf hash must be 32 bytes');
  }
  const sorted = validateAndSort(leafHashes);
  let idx = sorted.findIndex((h) => bytesEqual(h, targetLeafHash));
  if (idx === -1) {
    throw new Error('target_not_in_leaf_set');
  }

  const proof: MerkleProofStep[] = [];
  let level = sorted;
  while (level.length > 1) {
    const promoted = idx === level.length - 1 && level.length % 2 === 1;
    if (!promoted) {
      if (idx % 2 === 0) {
        proof.push({ sibling: level[idx + 1]!, position: 'right' });
      } else {
        proof.push({ sibling: level[idx - 1]!, position: 'left' });
      }
    }
    level = buildNextLevel(level);
    idx = Math.floor(idx / 2);
  }
  return proof;
};

/**
 * Verify a Merkle proof. Returns true iff walking the proof from `leafHash`
 * reproduces `expectedRoot`.
 */
export const verifyMerkleProof = (
  leafHash: Uint8Array,
  proof: MerkleProofStep[],
  expectedRoot: Uint8Array,
): boolean => {
  if (leafHash.length !== 32 || expectedRoot.length !== 32) return false;
  let current = leafHash;
  for (const step of proof) {
    if (step.sibling.length !== 32) return false;
    if (step.position !== 'left' && step.position !== 'right') return false;
    current =
      step.position === 'left'
        ? hashInternalNode(step.sibling, current)
        : hashInternalNode(current, step.sibling);
  }
  return bytesEqual(current, expectedRoot);
};
