import { describe, expect, it } from 'vitest';

import { computeShinglePayloadHash } from './hash.js';
import { computeBrowserShinglePayloadHash, shinglePlainTextInBrowser } from './browser.js';

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('browser shingling helpers', () => {
  it('matches the node canonical payload hash', async () => {
    const ctx = {
      preset: 'standard',
      sourceExtractionMethod: 'plain-text/v1',
    } as const;
    const text = 'the quick brown fox jumps over the';

    await expect(computeBrowserShinglePayloadHash(text, ctx)).resolves.toBe(
      toHex(computeShinglePayloadHash(text, ctx)),
    );
  });

  it('normalizes, shingles, and hashes plaintext without exposing plaintext', async () => {
    const result = await shinglePlainTextInBrowser(
      'Each producer normalizes and shingles plaintext locally before submitting.',
    );

    expect(result.normalizedTokenCount).toBe(9);
    expect(result.shingleCount).toBe(3);
    expect(result.shingles).toEqual([
      {
        sourceIndex: 0,
        canonicalPayloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        sourceIndex: 1,
        canonicalPayloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        sourceIndex: 2,
        canonicalPayloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it('dedupes repeated shingle hashes so manifests do not repeat leaves', async () => {
    const result = await shinglePlainTextInBrowser(
      'repeat repeat repeat repeat repeat repeat repeat repeat',
    );

    expect(result.normalizedTokenCount).toBe(8);
    expect(result.shingleCount).toBe(1);
    expect(result.shingles).toHaveLength(1);
  });
});
