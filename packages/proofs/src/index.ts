// @proveria/proofs — V1 lookup result-package schema, builders, signing, and
// self-verification helpers. See docs/v1 §17 and Protocol V1 §9.
//
// Optional signing mirrors @proveria/manifest and @proveria/receipt
// (SHA-256 of canonical bytes with signatures:[]).

export {
  PROOFS_PACKAGE_VERSION,
  RESULT_PACKAGE_V1_VERSIONS,
  NO_MATCH_STATEMENT,
  type ResultPackage,
  type ResultPackageType,
  type ResultSignature,
  type ResultSignerKind,
  type LookupScope,
  type ResultAttestation,
  type MatchPayload,
} from './types.js';

export {
  buildMatchResultPackage,
  buildNoMatchResultPackage,
  type BuildMatchResultPackageInput,
  type BuildNoMatchResultPackageInput,
} from './build.js';

export {
  buildResultSigningDigest,
  signResultPackage,
  verifyResultPackage,
  type ResultSigningDigest,
} from './sign.js';

export { verifyMatchProof } from './verify.js';
