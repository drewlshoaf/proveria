// Ed25519 keypair generation, signing, and verification.
// Uses Node's built-in WebCrypto (subtle), available in Node 22+. Both halves
// of the V1 trust spine — desktop manifest signatures and the Proveria platform
// signature — use this module. See docs/v1 §15.1.1 and
// docs/protocol/v1/desktop-trust-v1.md.
//
// Encoding: all keys and signatures cross system boundaries as base64url
// strings. The private key is exported as PKCS#8 DER bytes; the public key as
// raw 32-byte Ed25519 bytes.

import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const ALGO = { name: 'Ed25519' } as const;

const toBase64Url = (buf: ArrayBuffer | Uint8Array): string =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString(
    'base64url',
  );

const fromBase64Url = (s: string): Buffer => Buffer.from(s, 'base64url');

export interface Ed25519Keypair {
  /** Raw Ed25519 public key (32 bytes), base64url-encoded. */
  publicKey: string;
  /** PKCS#8-encoded Ed25519 private key, base64url-encoded. */
  privateKey: string;
}

export const generateEd25519Keypair = async (): Promise<Ed25519Keypair> => {
  const pair = (await subtle.generateKey(ALGO, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const pubRaw = await subtle.exportKey('raw', pair.publicKey);
  const privPkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  return {
    publicKey: toBase64Url(pubRaw),
    privateKey: toBase64Url(privPkcs8),
  };
};

export const signEd25519 = async (
  payload: Uint8Array,
  privateKeyBase64Url: string,
): Promise<string> => {
  const pkcs8 = fromBase64Url(privateKeyBase64Url);
  const key = await subtle.importKey('pkcs8', pkcs8, ALGO, false, ['sign']);
  const sig = await subtle.sign(ALGO, key, payload);
  return toBase64Url(sig);
};

export const verifyEd25519 = async (
  payload: Uint8Array,
  signatureBase64Url: string,
  publicKeyBase64Url: string,
): Promise<boolean> => {
  const raw = fromBase64Url(publicKeyBase64Url);
  const sig = fromBase64Url(signatureBase64Url);
  try {
    const key = await subtle.importKey('raw', raw, ALGO, false, ['verify']);
    return await subtle.verify(ALGO, key, sig, payload);
  } catch {
    // Malformed key or signature: treat as invalid rather than throw.
    return false;
  }
};
