// Result-package signing — same pattern as manifests/receipts: sign SHA-256 of
// the RFC 8785 canonical bytes with `signatures: []`, so an optional external
// signature binds every other field without recursion.

import { createHash } from 'node:crypto';

import {
  canonicalize,
  signEd25519,
  verifyEd25519,
} from '@proveria/crypto-core';

import type { ResultPackage } from './types.js';

export interface ResultSigningDigest {
  /** RFC 8785 canonical bytes of the package with signatures:[]. */
  canonicalBytes: Uint8Array;
  /** SHA-256 of canonicalBytes; this is what gets signed. */
  digest: Uint8Array;
}

export const buildResultSigningDigest = (
  pkg: ResultPackage,
): ResultSigningDigest => {
  const forSigning = { ...pkg, signatures: [] };
  const canonicalBytes = canonicalize(forSigning);
  const digest = new Uint8Array(
    createHash('sha256').update(canonicalBytes).digest(),
  );
  return { canonicalBytes, digest };
};

/** Sign with an external Ed25519 key, returning a signed copy. */
export const signResultPackage = async (
  pkg: ResultPackage,
  keyId: string,
  privateKeyBase64Url: string,
): Promise<ResultPackage> => {
  const { digest } = buildResultSigningDigest(pkg);
  const signature = await signEd25519(digest, privateKeyBase64Url);
  return {
    ...pkg,
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
 * Verify a Proveria-typed legacy signature on a package against a public key. Returns
 * false (never throws) for a missing signature, malformed key, or mismatch.
 */
export const verifyResultPackage = async (
  pkg: ResultPackage,
  publicKeyBase64Url: string,
  expectedKeyId?: string,
): Promise<boolean> => {
  const sig = pkg.signatures.find((s) => s.signer_kind === 'proveria');
  if (!sig || sig.algorithm !== 'ed25519') return false;
  if (expectedKeyId !== undefined && sig.key_id !== expectedKeyId) {
    return false;
  }
  const { digest } = buildResultSigningDigest(pkg);
  return verifyEd25519(digest, sig.signature, publicKeyBase64Url);
};
