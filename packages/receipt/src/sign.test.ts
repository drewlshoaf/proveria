import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { generateEd25519Keypair } from '@proveria/crypto-core';

import { buildAttestationReceipt } from './build.js';
import {
  buildReceiptSigningDigest,
  signReceipt,
  verifyReceipt,
} from './sign.js';
import type { AttestationReceipt } from './types.js';

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

interface ReceiptSigningVectorFile {
  fixedTestKeypair: {
    publicKey: string;
    privateKey: string;
  };
  vectors: Array<{
    name: string;
    input: {
      keyId: string;
      receipt: AttestationReceipt;
    };
    expected: {
      canonicalReceiptUtf8Hex: string;
      signingDigestHex: string;
      signatureBase64Url: string;
      verifies: boolean;
    };
  }>;
}

const loadReceiptSigningVectors = (): ReceiptSigningVectorFile =>
  JSON.parse(
    readFileSync(resolve(vectorsDir, 'receipt-signing.json'), 'utf8'),
  ) as ReceiptSigningVectorFile;

const fixtureReceipt = (): AttestationReceipt =>
  buildAttestationReceipt({
    packageId: 'pkg_01HZX8R3K9',
    tenantId: '11111111-1111-1111-1111-111111111111',
    projectId: '22222222-2222-2222-2222-222222222222',
    attestationId: '33333333-3333-3333-3333-333333333333',
    attestationLabel: 'draft-2026-q2',
    confirmedAttemptId: '44444444-4444-4444-4444-444444444444',
    manifestObjectKey: 'tenants/x/manifest.json',
    manifestCanonicalSha256:
      'c0a9acf68a3b0a044bdc477d1e66048d458f4a42482418831dbdcdb2106a90fd',
    merkleRoot:
      '12eef88597c4a1c220556988077012d592b737c19410afee0dc11bf8aa922723',
    leafCounts: { file: 2, shingle: 0, component: 0 },
    hashAlgorithm: 'sha256',
    protocolVersion: '1.0',
    deviceSignature: {
      key_id: '55555555-5555-5555-5555-555555555555',
      algorithm: 'ed25519',
      verified: true,
    },
    confirmedAt: '2026-05-14T12:00:00.000Z',
    issuedAt: '2026-05-14T12:00:01.000Z',
  });

describe('receipt-signing — spec vectors', () => {
  const file = loadReceiptSigningVectors();

  for (const v of file.vectors) {
    it(v.name, async () => {
      const { canonicalBytes, digest } = buildReceiptSigningDigest(
        v.input.receipt,
      );
      expect(hex(canonicalBytes)).toBe(v.expected.canonicalReceiptUtf8Hex);
      expect(hex(digest)).toBe(v.expected.signingDigestHex);

      const signed = await signReceipt(
        v.input.receipt,
        v.input.keyId,
        file.fixedTestKeypair.privateKey,
      );
      expect(signed.signatures[0]?.signature).toBe(
        v.expected.signatureBase64Url,
      );
      expect(
        await verifyReceipt(
          signed,
          file.fixedTestKeypair.publicKey,
          v.input.keyId,
        ),
      ).toBe(v.expected.verifies);
    });
  }
});

describe('buildReceiptSigningDigest', () => {
  it('is deterministic for the same receipt body', () => {
    const a = buildReceiptSigningDigest(fixtureReceipt());
    const b = buildReceiptSigningDigest(fixtureReceipt());
    expect(Buffer.from(a.digest)).toEqual(Buffer.from(b.digest));
  });

  it('ignores the signatures array — signed and unsigned digest match', async () => {
    const unsigned = fixtureReceipt();
    const signed = await signReceipt(unsigned, PROVERIA_KEY_ID, PRIVATE_KEY);
    expect(signed.signatures).toHaveLength(1);
    const unsignedDigest = buildReceiptSigningDigest(unsigned).digest;
    const signedDigest = buildReceiptSigningDigest(signed).digest;
    expect(Buffer.from(signedDigest)).toEqual(Buffer.from(unsignedDigest));
  });

  it('changes when any non-signature field changes', () => {
    const base = buildReceiptSigningDigest(fixtureReceipt()).digest;
    const mutated = buildReceiptSigningDigest({
      ...fixtureReceipt(),
      merkle_root: '0'.repeat(64),
    }).digest;
    expect(Buffer.from(mutated)).not.toEqual(Buffer.from(base));
  });
});

describe('signReceipt / verifyReceipt', () => {
  it('signs with the Proveria key and verifies round-trip', async () => {
    const signed = await signReceipt(
      fixtureReceipt(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    expect(signed.signatures[0]?.signer_kind).toBe('proveria');
    expect(signed.signatures[0]?.key_id).toBe(PROVERIA_KEY_ID);
    expect(await verifyReceipt(signed, PUBLIC_KEY)).toBe(true);
  });

  it('rejects a receipt with no Proveria signature', async () => {
    expect(await verifyReceipt(fixtureReceipt(), PUBLIC_KEY)).toBe(false);
  });

  it('rejects verification against a different public key', async () => {
    const signed = await signReceipt(
      fixtureReceipt(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    const other = await generateEd25519Keypair();
    expect(await verifyReceipt(signed, other.publicKey)).toBe(false);
  });

  it('rejects a receipt whose body was altered after signing', async () => {
    const signed = await signReceipt(
      fixtureReceipt(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    const tampered: AttestationReceipt = {
      ...signed,
      merkle_root: '0'.repeat(64),
    };
    expect(await verifyReceipt(tampered, PUBLIC_KEY)).toBe(false);
  });

  it('rejects a receipt whose signer key_id is not the expected platform key', async () => {
    const signed = await signReceipt(
      fixtureReceipt(),
      'unexpected-platform-key',
      PRIVATE_KEY,
    );
    expect(await verifyReceipt(signed, PUBLIC_KEY, PROVERIA_KEY_ID)).toBe(
      false,
    );
  });

  it('rejects a malformed public key without throwing', async () => {
    const signed = await signReceipt(
      fixtureReceipt(),
      PROVERIA_KEY_ID,
      PRIVATE_KEY,
    );
    expect(await verifyReceipt(signed, 'not-a-key')).toBe(false);
  });
});
