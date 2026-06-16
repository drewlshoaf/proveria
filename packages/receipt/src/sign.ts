// Receipt signing — mirrors the manifest §8.1 pattern: the signer signs
// SHA-256 of the RFC 8785 canonical bytes of the receipt with signatures:[].
// This binds the signature to every other field without recursion.
//
// The current product flow does not add Proveria as an attestor. These helpers
// remain for compatibility with legacy fixtures and optional external signing.

import { createHash } from 'node:crypto';

import {
  canonicalize,
  signEd25519,
  verifyEd25519,
} from '@proveria/crypto-core';

import type { AttestationReceipt } from './types.js';

export interface ReceiptSigningDigest {
  /** RFC 8785 canonical bytes of the receipt with signatures:[]. */
  canonicalBytes: Uint8Array;
  /** SHA-256 of canonicalBytes; this is what gets signed. */
  digest: Uint8Array;
}

/** Compute the canonical bytes + signing digest. Does not mutate the input. */
export const buildReceiptSigningDigest = (
  receipt: AttestationReceipt,
): ReceiptSigningDigest => {
  const forSigning = { ...receipt, signatures: [] };
  const canonicalBytes = canonicalize(forSigning);
  const digest = new Uint8Array(
    createHash('sha256').update(canonicalBytes).digest(),
  );
  return { canonicalBytes, digest };
};

/** Sign a receipt with an external Ed25519 key, returning a signed copy. */
export const signReceipt = async (
  receipt: AttestationReceipt,
  keyId: string,
  privateKeyBase64Url: string,
): Promise<AttestationReceipt> => {
  const { digest } = buildReceiptSigningDigest(receipt);
  const signature = await signEd25519(digest, privateKeyBase64Url);
  return {
    ...receipt,
    signatures: [
      {
        signer_kind: 'proveria',
        key_id: keyId,
        algorithm: 'ed25519',
        signature,
      },
    ],
  };
};

/**
 * Verify a Proveria-typed legacy signature on a receipt against a public key. Returns
 * false (never throws) for a missing signature, malformed key, or mismatch.
 */
export const verifyReceipt = async (
  receipt: AttestationReceipt,
  publicKeyBase64Url: string,
  expectedKeyId?: string,
): Promise<boolean> => {
  const sig = receipt.signatures.find((s) => s.signer_kind === 'proveria');
  if (!sig || sig.algorithm !== 'ed25519') return false;
  if (expectedKeyId !== undefined && sig.key_id !== expectedKeyId) {
    return false;
  }
  const { digest } = buildReceiptSigningDigest(receipt);
  return verifyEd25519(digest, sig.signature, publicKeyBase64Url);
};
