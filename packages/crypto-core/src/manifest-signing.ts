// Protocol V1 §8.1 — manifest signing payload.
//
// The desktop (and any other signer) signs SHA-256 of the canonical bytes of
// the manifest with `signatures` set to []. This binds the signature to every
// other field in the manifest without recursion.

import { createHash } from 'node:crypto';

import { canonicalize } from './canonical-json.js';

export interface SigningDigest {
  /** RFC 8785 canonical bytes of the manifest with signatures:[]. */
  canonicalBytes: Uint8Array;
  /** SHA-256 of canonicalBytes; this is what gets signed. */
  digest: Uint8Array;
}

/**
 * Compute the canonical bytes + signing digest for a manifest. Mutates
 * nothing — the input manifest is left intact; a copy with signatures
 * stripped is what gets canonicalized.
 */
export const buildSigningDigest = (
  manifest: Record<string, unknown>,
): SigningDigest => {
  const forSigning = { ...manifest, signatures: [] as unknown[] };
  const canonicalBytes = canonicalize(forSigning);
  const digest = new Uint8Array(
    createHash('sha256').update(canonicalBytes).digest(),
  );
  return { canonicalBytes, digest };
};
