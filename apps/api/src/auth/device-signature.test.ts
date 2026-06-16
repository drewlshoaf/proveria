import { describe, it, expect } from 'vitest';
import {
  generateEd25519Keypair,
  signEd25519,
  verifyEd25519,
} from '@proveria/crypto-core';
import {
  canonicalSignedBytes,
  SIGNATURE_PROTOCOL,
  buildDeviceSignatureHeaders,
} from './device-signature.js';

describe('canonicalSignedBytes', () => {
  it('produces the same bytes for the same inputs', () => {
    const a = canonicalSignedBytes(
      1700000000000,
      'POST',
      '/devices/x',
      new TextEncoder().encode('{"hello":"world"}'),
    );
    const b = canonicalSignedBytes(
      1700000000000,
      'POST',
      '/devices/x',
      new TextEncoder().encode('{"hello":"world"}'),
    );
    expect(Buffer.from(a).toString('hex')).toBe(
      Buffer.from(b).toString('hex'),
    );
  });

  it('differs when body changes', () => {
    const a = canonicalSignedBytes(
      1700000000000,
      'POST',
      '/x',
      new TextEncoder().encode('{"a":1}'),
    );
    const b = canonicalSignedBytes(
      1700000000000,
      'POST',
      '/x',
      new TextEncoder().encode('{"a":2}'),
    );
    expect(Buffer.from(a).toString('hex')).not.toBe(
      Buffer.from(b).toString('hex'),
    );
  });

  it('starts with the protocol identifier', () => {
    const out = canonicalSignedBytes(
      1700000000000,
      'GET',
      '/x',
      new Uint8Array(0),
    );
    const text = new TextDecoder().decode(out);
    expect(text.startsWith(`${SIGNATURE_PROTOCOL}\n`)).toBe(true);
  });
});

describe('buildDeviceSignatureHeaders roundtrip', () => {
  it('produces headers whose signature verifies against the public key', async () => {
    const kp = await generateEd25519Keypair();
    const deviceId = '00000000-0000-0000-0000-000000000001';
    const method = 'POST';
    const path = '/attestations/x/attempts/y/finalize';
    const body = new TextEncoder().encode('{"label":"smoke"}');

    const headers = await buildDeviceSignatureHeaders(
      (payload) => signEd25519(payload, kp.privateKey),
      deviceId,
      method,
      path,
      body,
      1700000000000,
    );

    expect(headers['X-Proveria-Device-Id']).toBe(deviceId);
    expect(headers['X-Proveria-Timestamp']).toBe('1700000000000');

    // Server-side: rebuild the canonical bytes and verify with the stored
    // public key.
    const canonical = canonicalSignedBytes(
      Number(headers['X-Proveria-Timestamp']),
      method,
      path,
      body,
    );
    const ok = await verifyEd25519(
      canonical,
      headers['X-Proveria-Signature'],
      kp.publicKey,
    );
    expect(ok).toBe(true);
  });
});
