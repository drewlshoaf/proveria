// Self-verification of a match result package — recomputes leaf_hash from
// the submitted_hash + leaf_type via the §4.1 construction, then walks the
// proof_path back to attestation.merkle_root.
//
// This is the cryptographic core of "self-verifiable" match results. It
// doesn't require a trusted public key — just the math.

import {
  computeLeafHash,
  isLeafType,
  verifyMerkleProof,
  type LeafType,
  type MerkleProofStep,
} from '@proveria/crypto-core';

import { RESULT_PACKAGE_V1_VERSIONS, type ResultPackage } from './types.js';

const fromHex = (h: string): Uint8Array =>
  new Uint8Array(Buffer.from(h, 'hex'));

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/**
 * Returns true iff:
 *   • the package is a match,
 *   • the submitted_hash, leaf_type, and protocol_version reproduce the
 *     declared leaf_id via Protocol V1 §4.1, and
 *   • the proof_path walks leaf_id back to attestation.merkle_root.
 *
 * Never throws — malformed hex / unknown leaf_type / mismatched lengths
 * return false.
 */
export const verifyMatchProof = (pkg: ResultPackage): boolean => {
  if (pkg.result_type !== 'match' || !pkg.match) return false;
  if (!isLeafType(pkg.match.leaf_type)) return false;

  let submittedHashBytes: Uint8Array;
  let rootBytes: Uint8Array;
  let leafIdBytes: Uint8Array;
  let proof: MerkleProofStep[];
  try {
    submittedHashBytes = fromHex(pkg.submitted_hash);
    rootBytes = fromHex(pkg.attestation.merkle_root);
    leafIdBytes = fromHex(pkg.match.leaf_id);
    proof = pkg.match.proof_path.map((step) => ({
      sibling: fromHex(step.sibling),
      position: step.position,
    }));
  } catch {
    return false;
  }

  if (submittedHashBytes.length !== 32) return false;
  if (leafIdBytes.length !== 32) return false;

  const recomputed = computeLeafHash({
    protocolVersion: pkg.protocol_version,
    leafType: pkg.match.leaf_type as LeafType,
    hashAlgorithm: RESULT_PACKAGE_V1_VERSIONS.hash_algorithm,
    canonicalPayloadHash: submittedHashBytes,
  });
  if (toHex(recomputed) !== pkg.match.leaf_id) return false;

  return verifyMerkleProof(leafIdBytes, proof, rootBytes);
};
