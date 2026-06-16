// Generates concrete expected values for docs/protocol/v1/test-vectors/*.json
// by running the reference implementation in @proveria/crypto-core against
// each vector's input. Idempotent: running it again produces identical files.
//
// Invoke: `pnpm --filter @proveria/crypto-core exec tsx scripts/generate-vectors.ts`

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildLeafHashInput,
  buildMerkleProof,
  buildSigningDigest,
  canonicalize,
  computeLeafHash,
  computeMerkleRoot,
  signEd25519,
  verifyEd25519,
  type LeafType,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectorsDir = resolve(here, '..', '..', '..', 'docs', 'protocol', 'v1', 'test-vectors');

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

const TEST_KEYPAIR = {
  publicKey: 'dc0vVx95x8IglqC7FCpzYNkrB_LzdugMT1u48xmzB9w',
  privateKey:
    'MC4CAQAwBQYDK2VwBCIEIBW8SzGCm7VvwnEZovGqbOhKwps0UGDnRg0VXmELQn42',
};

const readJson = (filename: string): Record<string, unknown> => {
  const p = resolve(vectorsDir, filename);
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
};

const writeJson = (filename: string, data: unknown): void => {
  const p = resolve(vectorsDir, filename);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
};

// ---------------------------------------------------------------------------

const updateCanonicalJson = (): void => {
  const file = readJson('canonical-json.json');
  const vectors = file.vectors as Array<{
    input: unknown;
    expected: { canonicalUtf8?: string; canonicalUtf8Hex?: string };
  }>;
  for (const v of vectors) {
    const bytes = canonicalize(v.input);
    v.expected.canonicalUtf8 = Buffer.from(bytes).toString('utf8');
    v.expected.canonicalUtf8Hex = toHex(bytes);
  }
  writeJson('canonical-json.json', file);
};

const updateLeafHash = (): void => {
  const file = readJson('leaf-hash.json');
  const vectors = file.vectors as Array<{
    input: {
      protocolVersion: string;
      leafType: string;
      hashAlgorithm: string;
      payloadHex: string;
    };
    expected: Record<string, unknown>;
  }>;
  for (const v of vectors) {
    const payload = fromHex(v.input.payloadHex);
    // canonical_payload_hash = SHA-256(payload) for file/sha256/v1.
    const payloadHash = new Uint8Array(
      createHash('sha256').update(payload).digest(),
    );
    const input = {
      protocolVersion: v.input.protocolVersion,
      leafType: v.input.leafType as LeafType,
      hashAlgorithm: v.input.hashAlgorithm,
      canonicalPayloadHash: payloadHash,
    };
    const leafHashInput = buildLeafHashInput(input);
    const leafHash = computeLeafHash(input);
    v.expected.payloadHashHex = toHex(payloadHash);
    v.expected.leafHashInputLengthBytes = leafHashInput.length;
    v.expected.leafHashInputHex = toHex(leafHashInput);
    v.expected.leafHashHex = toHex(leafHash);
  }
  writeJson('leaf-hash.json', file);
};

const updateMerkleTree = (): void => {
  const file = readJson('merkle-tree.json');
  const vectors = file.vectors as Array<{
    name: string;
    input: { leafHashesHex: string[] };
    expected: Record<string, unknown>;
  }>;
  for (const v of vectors) {
    const leaves = v.input.leafHashesHex.map(fromHex);
    try {
      const sorted = leaves.slice().sort((a, b) => {
        for (let i = 0; i < 32; i += 1) {
          const ai = a[i]!;
          const bi = b[i]!;
          if (ai !== bi) return ai - bi;
        }
        return 0;
      });
      const root = computeMerkleRoot(leaves);
      v.expected.sortedLeafHashesHex = sorted.map(toHex);
      v.expected.merkleRootHex = toHex(root);
      delete v.expected.error;
    } catch (err) {
      v.expected.error = (err as Error).message;
      v.expected.merkleRootHex = null;
      delete v.expected.sortedLeafHashesHex;
    }
  }
  writeJson('merkle-tree.json', file);
};

const updateMerkleProof = (): void => {
  const file = readJson('merkle-proof.json');
  const vectors = file.vectors as Array<{
    name: string;
    input: { leafHashesHex: string[]; targetLeafHashHex: string };
    expected: Record<string, unknown>;
  }>;
  for (const v of vectors) {
    const leaves = v.input.leafHashesHex.map(fromHex);
    const target = fromHex(v.input.targetLeafHashHex);
    const proof = buildMerkleProof(leaves, target);
    const root = computeMerkleRoot(leaves);
    v.expected.proofPath = proof.map((s) => ({
      sibling: toHex(s.sibling),
      position: s.position,
    }));
    v.expected.merkleRootHex = toHex(root);
  }
  writeJson('merkle-proof.json', file);
};

const updateManifestSigning = (): void => {
  const file = readJson('manifest-signing.json');
  const vectors = file.vectors as Array<{
    input: { manifest: Record<string, unknown> };
    expected: Record<string, unknown>;
  }>;
  for (const v of vectors) {
    const { canonicalBytes, digest } = buildSigningDigest(v.input.manifest);
    v.expected.canonicalManifestUtf8Hex = toHex(canonicalBytes);
    v.expected.signingDigestHex = toHex(digest);
  }
  writeJson('manifest-signing.json', file);
};

const updateReceiptSigning = async (): Promise<void> => {
  const file = readJson('receipt-signing.json');
  (file as { fixedTestKeypair: typeof TEST_KEYPAIR }).fixedTestKeypair =
    TEST_KEYPAIR;
  const vectors = file.vectors as Array<{
    input: { receipt: Record<string, unknown>; keyId: string };
    expected: Record<string, unknown>;
  }>;
  for (const v of vectors) {
    const { canonicalBytes, digest } = buildSigningDigest(v.input.receipt);
    const signature = await signEd25519(digest, TEST_KEYPAIR.privateKey);
    const verifies = await verifyEd25519(
      digest,
      signature,
      TEST_KEYPAIR.publicKey,
    );
    v.expected.canonicalReceiptUtf8Hex = toHex(canonicalBytes);
    v.expected.signingDigestHex = toHex(digest);
    v.expected.signatureBase64Url = signature;
    v.expected.verifies = verifies;
  }
  writeJson('receipt-signing.json', file);
};

const updateResultPackageSigning = async (): Promise<void> => {
  const file = readJson('result-package-signing.json');
  (file as { fixedTestKeypair: typeof TEST_KEYPAIR }).fixedTestKeypair =
    TEST_KEYPAIR;
  const vectors = file.vectors as Array<{
    input: { resultPackage: Record<string, unknown>; keyId: string };
    expected: Record<string, unknown>;
  }>;
  for (const v of vectors) {
    const { canonicalBytes, digest } = buildSigningDigest(
      v.input.resultPackage,
    );
    const signature = await signEd25519(digest, TEST_KEYPAIR.privateKey);
    const verifies = await verifyEd25519(
      digest,
      signature,
      TEST_KEYPAIR.publicKey,
    );
    v.expected.canonicalResultPackageUtf8Hex = toHex(canonicalBytes);
    v.expected.signingDigestHex = toHex(digest);
    v.expected.signatureBase64Url = signature;
    v.expected.verifies = verifies;
  }
  writeJson('result-package-signing.json', file);
};

const updateSignatureRoundtrip = async (): Promise<void> => {
  const file = readJson('signature-roundtrip.json');
  (file as { fixedTestKeypair: typeof TEST_KEYPAIR }).fixedTestKeypair =
    TEST_KEYPAIR;
  const vectors = file.vectors as Array<{
    name: string;
    input: { messageHex?: string; signatureFromVector?: string };
    expected: Record<string, unknown>;
  }>;
  // Pass 1: vectors that own their signature (have messageHex, no reference).
  const sigsByName = new Map<string, string>();
  for (const v of vectors) {
    if (v.input.messageHex && !v.input.signatureFromVector) {
      const message = fromHex(v.input.messageHex);
      const sig = await signEd25519(message, TEST_KEYPAIR.privateKey);
      sigsByName.set(v.name, sig);
      const ok = await verifyEd25519(message, sig, TEST_KEYPAIR.publicKey);
      v.expected.signatureBase64Url = sig;
      v.expected.verifies = ok;
    }
  }
  // Pass 2: vectors that reference another vector's signature (e.g. the
  // tampered-message case). These do NOT carry their own signatureBase64Url.
  for (const v of vectors) {
    if (v.input.signatureFromVector && v.input.messageHex) {
      const sig = sigsByName.get(v.input.signatureFromVector);
      if (!sig) {
        throw new Error(`unknown sig ref: ${v.input.signatureFromVector}`);
      }
      const message = fromHex(v.input.messageHex);
      const ok = await verifyEd25519(message, sig, TEST_KEYPAIR.publicKey);
      v.expected.verifies = ok;
      delete v.expected.signatureBase64Url;
    }
  }
  writeJson('signature-roundtrip.json', file);
};

(async () => {
  updateCanonicalJson();
  updateLeafHash();
  updateMerkleTree();
  updateMerkleProof();
  updateManifestSigning();
  await updateReceiptSigning();
  await updateResultPackageSigning();
  await updateSignatureRoundtrip();
  console.log('test-vectors updated.');
})();
