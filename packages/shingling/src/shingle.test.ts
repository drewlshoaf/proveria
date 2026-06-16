import { describe, it, expect } from 'vitest';

import { generateShingles } from './shingle.js';
import { tokenizeNormalized } from './tokenize.js';
import { normalizeForShingling } from './normalize.js';

const tokenize = (s: string): string[][] =>
  tokenizeNormalized(normalizeForShingling(s));

describe('generateShingles — standard preset (window=7, stride=1)', () => {
  it('worked example produces 6 shingles for 12-token input', () => {
    const paragraphs = tokenize(
      'The quick brown fox jumps over the lazy dog. The dog barks.',
    );
    const shingles = generateShingles(paragraphs, 'standard');
    expect(shingles).toHaveLength(6);
    expect(shingles[0]?.text).toBe('the quick brown fox jumps over the');
    expect(shingles[5]?.text).toBe('over the lazy dog the dog barks');
  });

  it('source indices are 0..N-1 in order', () => {
    const paragraphs = tokenize(
      'a b c d e f g h i j k l m n o',
    );
    const shingles = generateShingles(paragraphs, 'standard');
    expect(shingles.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('generateShingles — broad preset (window=12, stride=3)', () => {
  it('skips by stride between windows', () => {
    const paragraphs = tokenize(
      Array.from({ length: 20 }, (_, i) => `t${i}`).join(' '),
    );
    const shingles = generateShingles(paragraphs, 'broad');
    // 20 tokens, window 12, stride 3 → positions 0, 3, 6 → 3 shingles
    expect(shingles).toHaveLength(3);
    expect(shingles[0]?.text.split(' ')).toHaveLength(12);
    expect(shingles[0]?.text.split(' ')[0]).toBe('t0');
    expect(shingles[1]?.text.split(' ')[0]).toBe('t3');
    expect(shingles[2]?.text.split(' ')[0]).toBe('t6');
  });
});

describe('generateShingles — sensitive preset (window=4, stride=1)', () => {
  it('emits a shingle per position for a short input', () => {
    const paragraphs = tokenize('alpha beta gamma delta epsilon');
    const shingles = generateShingles(paragraphs, 'sensitive');
    expect(shingles).toHaveLength(2);
    expect(shingles[0]?.text).toBe('alpha beta gamma delta');
    expect(shingles[1]?.text).toBe('beta gamma delta epsilon');
  });
});

describe('paragraph + min-length behavior', () => {
  it('skips paragraphs shorter than the window', () => {
    const paragraphs = tokenize('short\n\nthis paragraph is long enough for standard preset to fire');
    const shingles = generateShingles(paragraphs, 'standard');
    // Paragraph 1 has 1 token, skipped. Paragraph 2 has 10 tokens →
    // 10 - 7 + 1 = 4 shingles, all from paragraph 2.
    expect(shingles).toHaveLength(4);
    expect(shingles[0]?.text.split(' ')[0]).toBe('this');
  });

  it('shingles do NOT cross paragraph boundaries', () => {
    const paragraphs = tokenize(
      'one two three four five six seven\n\neight nine ten eleven twelve thirteen fourteen',
    );
    const shingles = generateShingles(paragraphs, 'standard');
    // Each paragraph has exactly 7 tokens → 1 shingle each = 2 total.
    // Critically there's no shingle spanning the boundary.
    expect(shingles).toHaveLength(2);
    expect(shingles[0]?.text).toBe('one two three four five six seven');
    expect(shingles[1]?.text).toBe(
      'eight nine ten eleven twelve thirteen fourteen',
    );
  });

  it('empty input → no shingles', () => {
    expect(generateShingles([], 'standard')).toEqual([]);
  });
});
