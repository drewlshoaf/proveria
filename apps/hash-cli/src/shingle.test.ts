import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeShinglePayloadHash,
  generateShingles,
  normalizeForShingling,
  tokenizeNormalized,
} from '@proveria/shingling';
import { describe, expect, it } from 'vitest';

import { shingleFile } from './shingle.js';

const CORPUS = [
  'Proveria preserves provenance for digital documents.',
  'Each producer normalizes and shingles plaintext locally before submitting.',
  'Only canonical shingle payload hashes ever leave the producer machine.',
  'A consumer recomputes the same hash from the same passage to verify a match.',
].join(' ');

const writeTmp = async (s: string): Promise<string> => {
  const path = join(tmpdir(), `hash-cli-shingle-${randomUUID()}.txt`);
  await writeFile(path, s);
  return path;
};

describe('shingleFile', () => {
  it('produces canonical_payload_hashes that match @proveria/shingling directly', async () => {
    const path = await writeTmp(CORPUS);
    const r = await shingleFile(path, { preset: 'standard' });

    // Recompute the expected hashes via the same library the desktop uses,
    // with the same plain-text/v1 source tag. The CLI's bytes must match.
    const normalized = normalizeForShingling(CORPUS);
    const paragraphs = tokenizeNormalized(normalized);
    const expected = generateShingles(paragraphs, 'standard').map((s) =>
      Buffer.from(
        computeShinglePayloadHash(s.text, {
          preset: 'standard',
          sourceExtractionMethod: 'plain-text/v1',
        }),
      ).toString('hex'),
    );
    expect(r.shingles.map((s) => s.canonical_payload_hash)).toEqual(expected);
    expect(r.shingles.map((s) => s.source_index)).toEqual(
      expected.map((_, i) => i),
    );
  });

  it('uses the requested preset (broad widens the window)', async () => {
    const path = await writeTmp(CORPUS);
    const standard = await shingleFile(path, { preset: 'standard' });
    const broad = await shingleFile(path, { preset: 'broad' });
    // Broad window is 12, stride 3 vs standard 7/1 → strictly fewer shingles.
    expect(broad.shingle_count).toBeLessThan(standard.shingle_count);
    expect(broad.preset).toBe('broad');
    // Different preset → different canonical bytes → different hashes.
    expect(broad.shingles[0]?.canonical_payload_hash).not.toBe(
      standard.shingles[0]?.canonical_payload_hash,
    );
  });

  it('always tags source_extraction_method as plain-text/v1', async () => {
    const path = await writeTmp(CORPUS);
    const r = await shingleFile(path);
    expect(r.source_extraction_method).toBe('plain-text/v1');
  });

  it('reports plaintext-safe counts identical to the shingling pipeline', async () => {
    const path = await writeTmp(CORPUS);
    const r = await shingleFile(path, { preset: 'standard' });
    const normalized = normalizeForShingling(CORPUS);
    const paragraphs = tokenizeNormalized(normalized);
    const expectedTokens = paragraphs.reduce((s, p) => s + p.length, 0);
    expect(r.paragraph_count).toBe(paragraphs.length);
    expect(r.token_count).toBe(expectedTokens);
  });
});
