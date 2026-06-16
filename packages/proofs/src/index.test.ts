import { describe, it, expect } from 'vitest';

import {
  NO_MATCH_STATEMENT,
  PROOFS_PACKAGE_VERSION,
  RESULT_PACKAGE_V1_VERSIONS,
  buildMatchResultPackage,
  buildNoMatchResultPackage,
  buildResultSigningDigest,
  signResultPackage,
  verifyMatchProof,
  verifyResultPackage,
} from './index.js';

describe('@proveria/proofs — public surface', () => {
  it('exports a semver package version', () => {
    expect(PROOFS_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports the fixed V1 version fields and the no-match statement', () => {
    expect(RESULT_PACKAGE_V1_VERSIONS.schema_version).toBe('1.0');
    expect(RESULT_PACKAGE_V1_VERSIONS.protocol_version).toBe('1.0');
    expect(NO_MATCH_STATEMENT).toBe(
      "This hash was not present in this specific attestation's committed hash set.",
    );
  });

  it('exposes the builder, signing, and verification helpers', () => {
    expect(typeof buildMatchResultPackage).toBe('function');
    expect(typeof buildNoMatchResultPackage).toBe('function');
    expect(typeof buildResultSigningDigest).toBe('function');
    expect(typeof signResultPackage).toBe('function');
    expect(typeof verifyResultPackage).toBe('function');
    expect(typeof verifyMatchProof).toBe('function');
  });
});
