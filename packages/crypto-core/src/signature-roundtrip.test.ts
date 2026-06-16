import { describe, it, expect } from 'vitest';
import { signEd25519, verifyEd25519 } from './ed25519.js';
import { loadVectorFile, unhex } from './test-vectors.js';

interface SignatureVectorFile {
  fixedTestKeypair: { publicKey: string; privateKey: string };
  vectors: Array<{
    name: string;
    input: { messageHex?: string; signatureFromVector?: string };
    expected: { signatureBase64Url?: string; verifies: boolean };
  }>;
}

const file = loadVectorFile<SignatureVectorFile>('signature-roundtrip');
const { publicKey, privateKey } = file.fixedTestKeypair;

describe('signature-roundtrip — spec vectors', () => {
  for (const v of file.vectors) {
    it(v.name, async () => {
      if (v.input.messageHex && v.expected.signatureBase64Url) {
        const message = unhex(v.input.messageHex);
        // Ed25519 is deterministic — same key + message → same signature.
        const sig = await signEd25519(message, privateKey);
        if (!v.input.signatureFromVector) {
          expect(sig).toBe(v.expected.signatureBase64Url);
        }
        const verifies = await verifyEd25519(
          message,
          v.expected.signatureBase64Url,
          publicKey,
        );
        expect(verifies).toBe(v.expected.verifies);
      } else if (v.input.messageHex && v.input.signatureFromVector) {
        // Tampered-message case: the signature comes from another vector.
        const referenced = file.vectors.find(
          (x) => x.name === v.input.signatureFromVector,
        );
        if (!referenced?.expected.signatureBase64Url) {
          throw new Error('referenced vector has no signature');
        }
        const verifies = await verifyEd25519(
          unhex(v.input.messageHex),
          referenced.expected.signatureBase64Url,
          publicKey,
        );
        expect(verifies).toBe(v.expected.verifies);
      }
    });
  }
});
