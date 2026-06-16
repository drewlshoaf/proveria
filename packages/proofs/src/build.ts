// Builders for V1 lookup result packages. Always returns an unsigned package
// (`signatures: []`); the caller signs separately for Team/Enterprise tiers
// (Free packages are self-verifiable — see verify.ts).

import {
  NO_MATCH_STATEMENT,
  RESULT_PACKAGE_V1_VERSIONS,
  type LookupScope,
  type MatchPayload,
  type ResultAttestation,
  type ResultPackage,
} from './types.js';

interface BaseInput {
  packageId: string;
  /** Lowercase hex SHA-256 of whatever the consumer submitted. */
  submittedHash: string;
  lookupScope: LookupScope;
  attestation: ResultAttestation;
  /** ISO 8601 UTC; defaults to now. */
  createdAt?: string;
}

export interface BuildMatchResultPackageInput extends BaseInput {
  match: MatchPayload;
}

export type BuildNoMatchResultPackageInput = BaseInput;

export const buildMatchResultPackage = (
  input: BuildMatchResultPackageInput,
): ResultPackage => ({
  ...RESULT_PACKAGE_V1_VERSIONS,
  package_id: input.packageId,
  result_type: 'match',
  submitted_hash: input.submittedHash,
  lookup_scope: input.lookupScope,
  attestation: input.attestation,
  match: input.match,
  no_match_statement: null,
  signatures: [],
  created_at: input.createdAt ?? new Date().toISOString(),
});

export const buildNoMatchResultPackage = (
  input: BuildNoMatchResultPackageInput,
): ResultPackage => ({
  ...RESULT_PACKAGE_V1_VERSIONS,
  package_id: input.packageId,
  result_type: 'no_match',
  submitted_hash: input.submittedHash,
  lookup_scope: input.lookupScope,
  attestation: input.attestation,
  match: null,
  no_match_statement: NO_MATCH_STATEMENT,
  signatures: [],
  created_at: input.createdAt ?? new Date().toISOString(),
});
