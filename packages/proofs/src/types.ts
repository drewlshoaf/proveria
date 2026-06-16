// V1 lookup result-package schema (docs/v1 §17, Protocol V1 §9).
//
// The result package is the durable evidence artifact emitted for every
// consumer hash lookup. Match packages embed a Merkle proof; no-match
// packages embed the verbatim scoped non-membership statement. Both are
// RFC 8785 canonicalized. The product flow does not add Proveria as an
// attestor; signatures are reserved for optional external/customer signing.
//
// PROVISIONAL: schema is subject to the external cryptographic review that
// also gates the receipt schema. Same conformance caveat applies.

export type ResultPackageType = 'match' | 'no_match';
export type ResultSignerKind = 'proveria' | 'customer';

/** A signature over the package's §9 signing digest. signature is base64url. */
export interface ResultSignature {
  signer_kind: ResultSignerKind;
  key_id: string;
  algorithm: 'ed25519';
  signature: string;
}

/** The scope inside which non-membership / membership is being asserted. */
export interface LookupScope {
  tenant_id: string;
  project_id: string;
  attestation_id: string;
}

/** Public attestation context the consumer needs alongside the result. */
export interface ResultAttestation {
  label: string;
  confirmed_at: string;
  merkle_root: string;
  protocol_version: string;
}

/** Match payload — the Merkle proof step list and the matched leaf id. */
export interface MatchPayload {
  /** Canonical leaf id (= leaf_hash hex). */
  leaf_id: string;
  /** Leaf type, e.g. "file/sha256/v1". */
  leaf_type: string;
  /** For content-proof leaves, how source text was extracted before hashing. */
  source_extraction_method?: string;
  /** For content-proof leaves, the shingling preset used. */
  preset?: string;
  /** For content-proof leaves, the source shingle index. */
  source_index?: number;
  /** For component-proof leaves, the component proof method. */
  component_method?: string;
  /** For component-proof leaves, the source media type when applicable. */
  media_type?: string;
  /** Steps from leaf to root, per Protocol V1 §6.7. */
  proof_path: ReadonlyArray<{
    sibling: string;
    position: 'left' | 'right';
  }>;
}

/** The full V1 lookup result package. */
export interface ResultPackage {
  schema_version: string;
  protocol_version: string;
  canonicalization_version: string;
  merkle_version: string;
  verifier_version: string;
  /** Stable id for this result package. */
  package_id: string;
  result_type: ResultPackageType;
  /** The hash the consumer submitted, lowercase hex. */
  submitted_hash: string;
  hash_algorithm: string;
  hash_algorithm_version: string;
  lookup_scope: LookupScope;
  attestation: ResultAttestation;
  /** Present only when result_type is 'match'. */
  match: MatchPayload | null;
  /** Present only when result_type is 'no_match'. Verbatim per §9.3. */
  no_match_statement: string | null;
  signatures: ResultSignature[];
  created_at: string;
}

/** V1 fixed version fields — every package carries the same values. */
export const RESULT_PACKAGE_V1_VERSIONS = {
  schema_version: '1.0',
  protocol_version: '1.0',
  canonicalization_version: '1.0',
  merkle_version: '1.0',
  verifier_version: '1.0',
  hash_algorithm: 'sha256',
  hash_algorithm_version: '1.0',
} as const;

/**
 * Verbatim no-match assertion (Protocol V1 §9.3). The string is part of the
 * canonical package bytes when an optional external signature is present.
 *
 * "Never claim universal absence — only absence from the specific committed set."
 */
export const NO_MATCH_STATEMENT =
  "This hash was not present in this specific attestation's committed hash set.";

export const PROOFS_PACKAGE_VERSION = '0.0.0';
