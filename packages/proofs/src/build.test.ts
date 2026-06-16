import { describe, it, expect } from 'vitest';

import {
  buildMatchResultPackage,
  buildNoMatchResultPackage,
  type BuildMatchResultPackageInput,
} from './build.js';
import { NO_MATCH_STATEMENT } from './types.js';

const baseInput = (): Omit<BuildMatchResultPackageInput, 'match'> => ({
  packageId: 'pkg_test_01',
  submittedHash:
    'c0a9acf68a3b0a044bdc477d1e66048d458f4a42482418831dbdcdb2106a90fd',
  lookupScope: {
    tenant_id: '11111111-1111-1111-1111-111111111111',
    project_id: '22222222-2222-2222-2222-222222222222',
    attestation_id: '33333333-3333-3333-3333-333333333333',
  },
  attestation: {
    label: 'q2-snapshot',
    confirmed_at: '2026-05-14T12:00:00.000Z',
    merkle_root:
      'bc6b943b820c449acf880d293c216a24a8066b153f87f2361fae2beda3a72641',
    protocol_version: '1.0',
  },
  createdAt: '2026-05-15T08:00:00.000Z',
});

describe('buildMatchResultPackage', () => {
  it('assembles a V1 match package with fixed schema fields and no signatures', () => {
    const pkg = buildMatchResultPackage({
      ...baseInput(),
      match: {
        leaf_id:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        leaf_type: 'file/sha256/v1',
        proof_path: [
          {
            sibling:
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            position: 'right',
          },
        ],
      },
    });
    expect(pkg.schema_version).toBe('1.0');
    expect(pkg.protocol_version).toBe('1.0');
    expect(pkg.result_type).toBe('match');
    expect(pkg.match?.proof_path).toHaveLength(1);
    expect(pkg.no_match_statement).toBeNull();
    expect(pkg.signatures).toEqual([]);
  });

  it('carries every input through to the package body', () => {
    const i = {
      ...baseInput(),
      match: {
        leaf_id: 'a'.repeat(64),
        leaf_type: 'file/sha256/v1',
        proof_path: [],
      },
    };
    const pkg = buildMatchResultPackage(i);
    expect(pkg.package_id).toBe(i.packageId);
    expect(pkg.submitted_hash).toBe(i.submittedHash);
    expect(pkg.lookup_scope).toEqual(i.lookupScope);
    expect(pkg.attestation).toEqual(i.attestation);
    expect(pkg.match).toEqual(i.match);
    expect(pkg.created_at).toBe(i.createdAt);
  });
});

describe('buildNoMatchResultPackage', () => {
  it('writes the verbatim §9.3 no-match statement and nulls the match field', () => {
    const pkg = buildNoMatchResultPackage(baseInput());
    expect(pkg.result_type).toBe('no_match');
    expect(pkg.match).toBeNull();
    expect(pkg.no_match_statement).toBe(NO_MATCH_STATEMENT);
    expect(pkg.signatures).toEqual([]);
  });
});
