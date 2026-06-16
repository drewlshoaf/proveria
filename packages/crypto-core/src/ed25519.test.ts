import { describe, it, expect } from 'vitest';
import {
  generateEd25519Keypair,
  signEd25519,
  verifyEd25519,
} from './ed25519.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('Ed25519', () => {
  it('generates a 32-byte public key (43 base64url chars)', async () => {
    const kp = await generateEd25519Keypair();
    expect(kp.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // PKCS#8 for Ed25519 is 48 bytes → 64 base64url chars unpadded.
    expect(kp.privateKey).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it('roundtrips sign + verify on a small payload', async () => {
    const kp = await generateEd25519Keypair();
    const payload = enc('hello proveria');
    const sig = await signEd25519(payload, kp.privateKey);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await verifyEd25519(payload, sig, kp.publicKey)).toBe(true);
  });

  it('verify returns false for a tampered payload', async () => {
    const kp = await generateEd25519Keypair();
    const sig = await signEd25519(enc('original'), kp.privateKey);
    expect(await verifyEd25519(enc('tampered'), sig, kp.publicKey)).toBe(false);
  });

  it('verify returns false for a signature from a different key', async () => {
    const a = await generateEd25519Keypair();
    const b = await generateEd25519Keypair();
    const payload = enc('cross-key test');
    const sig = await signEd25519(payload, a.privateKey);
    expect(await verifyEd25519(payload, sig, b.publicKey)).toBe(false);
  });

  it('verify returns false (does not throw) for a malformed public key', async () => {
    const kp = await generateEd25519Keypair();
    const sig = await signEd25519(enc('x'), kp.privateKey);
    expect(await verifyEd25519(enc('x'), sig, 'not-a-key')).toBe(false);
  });

  it('produces deterministic signatures for the same {key, payload}', async () => {
    // Ed25519 signatures are deterministic by spec — same key + same payload
    // → identical signature bytes. Useful test-vector property.
    const kp = await generateEd25519Keypair();
    const payload = enc('determinism check');
    const a = await signEd25519(payload, kp.privateKey);
    const b = await signEd25519(payload, kp.privateKey);
    expect(a).toBe(b);
  });
});
