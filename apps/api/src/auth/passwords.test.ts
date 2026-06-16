import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from './passwords.js';

describe('passwords', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a).not.toBe(b);
  });

  it('throws on empty password input', async () => {
    await expect(hashPassword('')).rejects.toThrow(/non-empty/);
  });

  it('returns false (not throw) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false);
  });

  it('needsRehash returns true for non-argon2id inputs', () => {
    expect(needsRehash('plain-text-not-a-hash')).toBe(true);
  });
});
