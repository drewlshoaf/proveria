import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildMerkleProof,
  computeLeafHash,
  computeMerkleRoot,
  LEAF_TYPES,
} from '@proveria/crypto-core';
import {
  buildMatchResultPackage,
  buildNoMatchResultPackage,
  NO_MATCH_STATEMENT,
} from '@proveria/proofs';
import { describe, expect, it } from 'vitest';

import { verifyPackageFile } from './verify.js';

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const buildMatchPkg = () => {
  // 4-leaf tree, target idx 1.
  const payloadHashes = [1, 2, 3, 4].map((i) => {
    const b = new Uint8Array(32);
    b[31] = i;
    return b;
  });
  const leafHashes = payloadHashes.map((p) =>
    computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.fileSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: p,
    }),
  );
  const target = leafHashes[1]!;
  const root = computeMerkleRoot(leafHashes);
  const proof = buildMerkleProof(leafHashes, target);
  return buildMatchResultPackage({
    packageId: 'pkg_cli_verify',
    submittedHash: toHex(payloadHashes[1]!),
    lookupScope: {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      project_id: '22222222-2222-2222-2222-222222222222',
      attestation_id: '33333333-3333-3333-3333-333333333333',
    },
    attestation: {
      label: 'cli-verify',
      confirmed_at: '2026-05-18T12:00:00.000Z',
      merkle_root: toHex(root),
      protocol_version: '1.0',
    },
    match: {
      leaf_id: toHex(target),
      leaf_type: LEAF_TYPES.fileSha256V1,
      proof_path: proof.map((s) => ({
        sibling: toHex(s.sibling),
        position: s.position,
      })),
    },
  });
};

const writeTmpJson = async (obj: unknown): Promise<string> => {
  const path = join(tmpdir(), `cli-verify-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(obj));
  return path;
};

describe('verifyPackageFile', () => {
  it('OKs a well-formed unsigned match package', async () => {
    const pkg = buildMatchPkg();
    const path = await writeTmpJson(pkg);
    const r = await verifyPackageFile(path);
    expect(r.kind).toBe('verify');
    expect(r.proof_ok).toBe(true);
    expect(r.signature_required).toBe(false);
    expect(r.signature_verified).toBeNull();
    expect(r.result_type).toBe('match');
  });

  it('FAILs a match package whose submitted_hash was tampered after issuance', async () => {
    const pkg = buildMatchPkg();
    const tampered = { ...pkg, submitted_hash: '0'.repeat(64) };
    const path = await writeTmpJson(tampered);
    const r = await verifyPackageFile(path);
    expect(r.proof_ok).toBe(false);
  });

  it('OKs a no-match package with the exact §9.3 statement', async () => {
    const pkg = buildNoMatchResultPackage({
      packageId: 'pkg_no_match',
      submittedHash: '0'.repeat(64),
      lookupScope: {
        tenant_id: '11111111-1111-1111-1111-111111111111',
        project_id: '22222222-2222-2222-2222-222222222222',
        attestation_id: '33333333-3333-3333-3333-333333333333',
      },
      attestation: {
        label: 'cli-verify',
        confirmed_at: '2026-05-18T12:00:00.000Z',
        merkle_root: 'a'.repeat(64),
        protocol_version: '1.0',
      },
    });
    const path = await writeTmpJson(pkg);
    const r = await verifyPackageFile(path);
    expect(r.proof_ok).toBe(true);
    expect(r.no_match_statement_ok).toBe(true);
  });

  it('FAILs a no-match package whose statement was edited', async () => {
    const pkg = buildNoMatchResultPackage({
      packageId: 'pkg_no_match_bad',
      submittedHash: '0'.repeat(64),
      lookupScope: {
        tenant_id: '11111111-1111-1111-1111-111111111111',
        project_id: '22222222-2222-2222-2222-222222222222',
        attestation_id: '33333333-3333-3333-3333-333333333333',
      },
      attestation: {
        label: 'cli-verify',
        confirmed_at: '2026-05-18T12:00:00.000Z',
        merkle_root: 'a'.repeat(64),
        protocol_version: '1.0',
      },
    });
    const tampered = {
      ...pkg,
      no_match_statement: NO_MATCH_STATEMENT + ' (tampered)',
    };
    const path = await writeTmpJson(tampered);
    const r = await verifyPackageFile(path);
    expect(r.proof_ok).toBe(false);
    expect(r.no_match_statement_ok).toBe(false);
  });

  it('throws cleanly on unparseable JSON', async () => {
    const path = join(tmpdir(), `cli-verify-bad-${randomUUID()}.json`);
    await writeFile(path, '{not json');
    await expect(verifyPackageFile(path)).rejects.toThrow(/could not parse/);
  });
});
