import { describe, it, expect } from 'vitest';

import { normalizeForShingling } from './normalize.js';
import { tokenizeNormalized } from './tokenize.js';

describe('tokenizeNormalized', () => {
  it('returns [] for empty input', () => {
    expect(tokenizeNormalized('')).toEqual([]);
  });

  it('splits a single paragraph on spaces', () => {
    expect(tokenizeNormalized('hello world foo')).toEqual([
      ['hello', 'world', 'foo'],
    ]);
  });

  it('produces one token array per paragraph', () => {
    expect(tokenizeNormalized('one two\n\nthree four five')).toEqual([
      ['one', 'two'],
      ['three', 'four', 'five'],
    ]);
  });

  it('keeps hyphens inside tokens', () => {
    expect(tokenizeNormalized('well-known long-running thing')).toEqual([
      ['well-known', 'long-running', 'thing'],
    ]);
  });

  it('round-trips with normalize for the worked example', () => {
    const normalized = normalizeForShingling(
      'The quick brown fox jumps over the lazy dog. The dog barks.',
    );
    expect(tokenizeNormalized(normalized)).toEqual([
      ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog', 'the', 'dog', 'barks'],
    ]);
  });
});
