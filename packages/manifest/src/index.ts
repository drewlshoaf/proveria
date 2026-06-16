// @proveria/manifest — V1 manifest schema, builder, and validator.
// Built on @proveria/crypto-core's leaf-hash + Merkle + signing primitives.
// See docs/v1 §13 and docs/protocol/v1/protocol-v1.md §7–§8.

export {
  MANIFEST_V1_VERSIONS,
  MANIFEST_PACKAGE_VERSION,
  type LeafCounts,
  type LeafEntry,
  type Manifest,
  type SignatureEntry,
  type SignerKind,
  type SourceSummary,
} from './types.js';

export {
  buildManifest,
  type BuildManifestInput,
  type LeafDescriptor,
} from './build.js';

export {
  validateManifest,
  verifyManifestSignature,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
