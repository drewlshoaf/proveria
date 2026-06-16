import { describe, it, expect } from 'vitest';

import {
  buildMerkleProof,
  computeLeafHash,
  computeMerkleRoot,
  LEAF_TYPES,
} from '@proveria/crypto-core';

import { buildMatchResultPackage } from './build.js';
import { verifyMatchProof } from './verify.js';

const fromHex = (h: string): Uint8Array =>
  new Uint8Array(Buffer.from(h, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

// Build a Merkle tree from N distinct payload hashes and return everything a
// result-package match would carry for the first leaf.
const buildFixture = (
  n: number,
  targetIdx = 0,
): {
  submittedHash: string;
  leafIdHex: string;
  merkleRootHex: string;
  proof: ReadonlyArray<{ sibling: string; position: 'left' | 'right' }>;
} => {
  const payloadHashes: Uint8Array[] = [];
  for (let i = 1; i <= n; i += 1) {
    const b = new Uint8Array(32);
    b[31] = i;
    payloadHashes.push(b);
  }
  const leafHashes = payloadHashes.map((p) =>
    computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.fileSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: p,
    }),
  );
  const targetLeafHash = leafHashes[targetIdx]!;
  const root = computeMerkleRoot(leafHashes);
  const proofSteps = buildMerkleProof(leafHashes, targetLeafHash);
  return {
    submittedHash: toHex(payloadHashes[targetIdx]!),
    leafIdHex: toHex(targetLeafHash),
    merkleRootHex: toHex(root),
    proof: proofSteps.map((s) => ({
      sibling: toHex(s.sibling),
      position: s.position,
    })),
  };
};

const wrapMatch = (
  f: ReturnType<typeof buildFixture>,
): ReturnType<typeof buildMatchResultPackage> =>
  buildMatchResultPackage({
    packageId: 'pkg_verify',
    submittedHash: f.submittedHash,
    lookupScope: {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      project_id: '22222222-2222-2222-2222-222222222222',
      attestation_id: '33333333-3333-3333-3333-333333333333',
    },
    attestation: {
      label: 'verify-test',
      confirmed_at: '2026-05-14T12:00:00.000Z',
      merkle_root: f.merkleRootHex,
      protocol_version: '1.0',
    },
    match: {
      leaf_id: f.leafIdHex,
      leaf_type: LEAF_TYPES.fileSha256V1,
      proof_path: f.proof,
    },
  });

describe('verifyMatchProof', () => {
  it('verifies a single-leaf tree (empty proof path)', () => {
    expect(verifyMatchProof(wrapMatch(buildFixture(1)))).toBe(true);
  });

  it('verifies a 2-leaf tree', () => {
    expect(verifyMatchProof(wrapMatch(buildFixture(2)))).toBe(true);
  });

  it('verifies the §6.5 odd-leaf promotion case (3 leaves, target promoted)', () => {
    expect(verifyMatchProof(wrapMatch(buildFixture(3, 2)))).toBe(true);
  });

  it('verifies a target in the middle of an 8-leaf balanced tree', () => {
    expect(verifyMatchProof(wrapMatch(buildFixture(8, 3)))).toBe(true);
  });

  it('rejects a tampered submitted_hash (leaf_id no longer recomputes)', () => {
    const pkg = wrapMatch(buildFixture(4));
    const tampered = { ...pkg, submitted_hash: '0'.repeat(64) };
    expect(verifyMatchProof(tampered)).toBe(false);
  });

  it('rejects a tampered merkle_root (proof walk no longer matches)', () => {
    const pkg = wrapMatch(buildFixture(4));
    const tampered = {
      ...pkg,
      attestation: { ...pkg.attestation, merkle_root: '0'.repeat(64) },
    };
    expect(verifyMatchProof(tampered)).toBe(false);
  });

  it('rejects no_match packages', () => {
    const pkg = wrapMatch(buildFixture(4));
    const wrong = { ...pkg, result_type: 'no_match' as const, match: null };
    expect(verifyMatchProof(wrong)).toBe(false);
  });

  it('rejects an unknown leaf_type', () => {
    const pkg = wrapMatch(buildFixture(4));
    const wrong = {
      ...pkg,
      match: { ...pkg.match!, leaf_type: 'unknown/sha256/v1' },
    };
    expect(verifyMatchProof(wrong)).toBe(false);
  });

  it('rejects malformed hex without throwing', () => {
    const pkg = wrapMatch(buildFixture(4));
    const wrong = { ...pkg, submitted_hash: 'not-hex' };
    expect(verifyMatchProof(wrong)).toBe(false);
  });

  it('rejects a proof step with an invalid sibling position', () => {
    const pkg = wrapMatch(buildFixture(2));
    const wrong = {
      ...pkg,
      match: {
        ...pkg.match!,
        proof_path: pkg.match!.proof_path.map((step, i) =>
          i === 0 ? { ...step, position: 'sideways' as 'right' } : step,
        ),
      },
    };
    expect(verifyMatchProof(wrong)).toBe(false);
  });

  // Sanity: the recomputed leaf_id matches what crypto-core gives us.
  it('the fixture leaf_id matches crypto-core computeLeafHash', () => {
    const f = buildFixture(1);
    const recomputed = computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.fileSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: fromHex(f.submittedHash),
    });
    expect(toHex(recomputed)).toBe(f.leafIdHex);
  });
});
