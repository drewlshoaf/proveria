// Hashing, Merkle tree, signatures, and canonicalization primitives.
// The trust-spine surface implemented per docs/protocol/v1/protocol-v1.md.

export {
  generateEd25519Keypair,
  signEd25519,
  verifyEd25519,
  type Ed25519Keypair,
} from './ed25519.js';

export {
  canonicalize,
  canonicalizeToString,
} from './canonical-json.js';

export {
  LEAF_TYPES,
  LEAF_TYPE_VALUES,
  isLeafType,
  buildLeafHashInput,
  computeLeafHash,
  type LeafInput,
  type LeafType,
} from './leaf-hash.js';

export {
  buildMerkleProof,
  computeMerkleRoot,
  sortAndValidateLeaves,
  verifyMerkleProof,
  type MerkleProofStep,
} from './merkle.js';

export {
  buildSigningDigest,
  type SigningDigest,
} from './manifest-signing.js';

export const CRYPTO_CORE_PACKAGE_VERSION = '0.0.0';
