import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { generateEd25519Keypair } from '@proveria/crypto-core';

import { buildNoMatchResultPackage } from './build.js';
import {
  buildResultSigningDigest,
  signResultPackage,
  verifyResultPackage,
} from './sign.js';
import type { ResultPackage } from './types.js';

// The fixed Protocol V1 test keypair (docs/protocol/v1/test-vectors).
const PROVERIA_KEY_ID = 'proveria-platform-key-v1';
const PUBLIC_KEY = 'dc0vVx95x8IglqC7FCpzYNkrB_LzdugMT1u48xmzB9w';
const PRIVATE_KEY =
  'MC4CAQAwBQYDK2VwBCIEIBW8SzGCm7VvwnEZovGqbOhKwps0UGDnRg0VXmELQn42';

const here = dirname(fileURLToPath(import.meta.url));
const vectorsDir = resolve(
  here,
  '..',
  '..',
  '..',
  'docs',
  'protocol',
  'v1',
  'test-vectors',
);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

interface ResultPackageSigningVectorFile {
  fixedTestKeypair: {
    publicKey: string;
    privateKey: string;
  };
  vectors: Array<{
    name: string;
    input: {
      keyId: string;
      resultPackage: ResultPackage;
    };
    expected: {
      canonicalResultPackageUtf8Hex: string;
      signingDigestHex: string;
      signatureBase64Url: string;
      verifies: boolean;
    };
  }>;
}

const loadResultPackageSigningVectors = (): ResultPackageSigningVectorFile =>
  JSON.parse(
    readFileSync(resolve(vectorsDir, 'result-package-signing.json'), 'utf8'),
  ) as ResultPackageSigningVectorFile;

const fixture = (): ResultPackage =>
  buildNoMatchResultPackage({
    packageId: 'pkg_sign_test',
    submittedHash: 'a'.repeat(64),
    lookupScope: {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      project_id: '22222222-2222-2222-2222-222222222222',
      attestation_id: '33333333-3333-3333-3333-333333333333',
    },
    attestation: {
      label: 'sign-test',
      confirmed_at: '2026-05-14T12:00:00.000Z',
      merkle_root: 'b'.repeat(64),
      protocol_version: '1.0',
    },
    createdAt: '2026-05-15T08:00:00.000Z',
  });

describe('result-package-signing — spec vectors', () => {
  const file = loadResultPackageSigningVectors();

  for (const v of file.vectors) {
    it(v.name, async () => {
      const { canonicalBytes, digest } = buildResultSigningDigest(
        v.input.resultPackage,
      );
      expect(hex(canonicalBytes)).toBe(
        v.expected.canonicalResultPackageUtf8Hex,
      );
      expect(hex(digest)).toBe(v.expected.signingDigestHex);

      const signed = await signResultPackage(
        v.input.resultPackage,
        v.input.keyId,
        file.fixedTestKeypair.privateKey,
      );
      expect(signed.signatures[0]?.signature).toBe(
        v.expected.signatureBase64Url,
      );
      expect(
        await verifyResultPackage(
          signed,
          file.fixedTestKeypair.publicKey,
          v.input.keyId,
        ),
      ).toBe(v.expected.verifies);
    });
  }
});

describe('buildResultSigningDigest', () => {
  it('is deterministic for the same package body', () => {
    const a = buildResultSigningDigest(fixture());
    const b = buildResultSigningDigest(fixture());
    expect(Buffer.from(a.digest)).toEqual(Buffer.from(b.digest));
  });

  it('ignores the signatures array — signed and unsigned digests match', async () => {
    const unsigned = fixture();
    const signed = await signResultPackage(unsigned, PROVERIA_KEY_ID, PRIVATE_KEY);
    expect(signed.signatures).toHaveLength(1);
    const a = buildResultSigningDigest(unsigned).digest;
    const b = buildResultSigningDigest(signed).digest;
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });

  it('changes when any non-signature field changes', () => {
    const base = buildResultSigningDigest(fixture()).digest;
    const mutated = buildResultSigningDigest({
      ...fixture(),
      submitted_hash: '0'.repeat(64),
    }).digest;
    expect(Buffer.from(mutated)).not.toEqual(Buffer.from(base));
  });
});

describe('signResultPackage / verifyResultPackage', () => {
  it('round-trips with the matching public key', async () => {
    const signed = await signResultPackage(
      fixture(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    expect(signed.signatures[0]?.signer_kind).toBe('proveria');
    expect(await verifyResultPackage(signed, PUBLIC_KEY)).toBe(true);
  });

  it('rejects an unsigned (Free-tier) package', async () => {
    expect(await verifyResultPackage(fixture(), PUBLIC_KEY)).toBe(false);
  });

  it('rejects verification against a different public key', async () => {
    const signed = await signResultPackage(
      fixture(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    const other = await generateEd25519Keypair();
    expect(await verifyResultPackage(signed, other.publicKey)).toBe(false);
  });

  it('rejects a package whose no-match statement was altered after signing', async () => {
    const signed = await signResultPackage(
      fixture(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    const tampered: ResultPackage = {
      ...signed,
      no_match_statement: 'This hash IS present.',
    };
    expect(await verifyResultPackage(tampered, PUBLIC_KEY)).toBe(false);
  });

  it('rejects a package whose signer key_id is not the expected platform key', async () => {
    const signed = await signResultPackage(
      fixture(),
      'unexpected-platform-key',
      PRIVATE_KEY,
    );
    expect(
      await verifyResultPackage(signed, PUBLIC_KEY, PROVERIA_KEY_ID),
    ).toBe(false);
  });

  it('rejects a malformed public key without throwing', async () => {
    const signed = await signResultPackage(
      fixture(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    expect(await verifyResultPackage(signed, 'not-a-key')).toBe(false);
  });
});
