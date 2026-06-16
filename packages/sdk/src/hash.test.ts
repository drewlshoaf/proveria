import { describe, expect, it } from 'vitest';

import { passageProofHashes, sha256Hex } from './hash.js';

describe('hash helpers', () => {
  it('computes sha256 hex', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('generates passage proof hashes', async () => {
    const result = await passageProofHashes(
      'A law firm may need to prove that a contract clause existed in the signed agreement.',
    );
    expect(result.normalizedTokenCount).toBeGreaterThan(6);
    expect(result.hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
