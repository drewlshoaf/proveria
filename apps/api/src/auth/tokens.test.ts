import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, isWithinWindow } from './tokens.js';

describe('tokens', () => {
  it('generates a 32-byte base64url token (43 chars unpadded)', () => {
    const { token, hash } = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashToken is deterministic and matches generateToken', () => {
    const { token, hash } = generateToken();
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('generates distinct tokens across calls', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
  });

  it('isWithinWindow returns true before expiry, false after', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(
      isWithinWindow(new Date('2026-01-01T00:01:00Z'), now),
    ).toBe(true);
    expect(
      isWithinWindow(new Date('2025-12-31T23:59:00Z'), now),
    ).toBe(false);
  });
});
