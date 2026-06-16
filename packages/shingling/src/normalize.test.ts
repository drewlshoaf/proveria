import { describe, it, expect } from 'vitest';

import { normalizeForShingling } from './normalize.js';

describe('normalizeForShingling', () => {
  it('returns empty for empty input', () => {
    expect(normalizeForShingling('')).toBe('');
  });

  it('lowercases + NFC', () => {
    // É (U+00C9, precomposed) → "é" lowercase
    expect(normalizeForShingling('HelloÉ')).toBe('helloé');
  });

  it('replaces smart punctuation with ASCII equivalents', () => {
    const input = '‘hi’ “there” – — …';
    // After punct → space + collapse + trim:
    //   ' '+'hi'+' '+' '+'there'+' '+'-'+' '+'-' (ellipsis → ... then dot → space)
    // ... → '...' → after punct: spaces → trim → "hi there - -"
    expect(normalizeForShingling(input)).toBe('hi there - -');
  });

  it('decomposes the Latin ligatures', () => {
    // Each input word uses ONE ligature in place of one cluster:
    //   oﬃce → "ffi" → office,  ﬂag → "fl" → flag,  aﬀix → "ff" → affix.
    expect(normalizeForShingling('oﬃce ﬂag aﬀix')).toBe(
      'office flag affix',
    );
  });

  it('removes soft hyphens', () => {
    expect(normalizeForShingling('exam­ple')).toBe('example');
  });

  it('joins hyphenated line breaks (PDF wrap)', () => {
    expect(normalizeForShingling('well-\nknown thing')).toBe('wellknown thing');
    // ...with trailing indent on the next line:
    expect(normalizeForShingling('infor-\n    mation')).toBe('information');
  });

  it('treats form feed as a paragraph boundary', () => {
    expect(normalizeForShingling('alpha\fbeta')).toBe('alpha\n\nbeta');
  });

  it('collapses multi-line-break runs into a single \\n\\n', () => {
    expect(normalizeForShingling('a\n\n\nb')).toBe('a\n\nb');
    expect(normalizeForShingling('a\n \n b')).toBe('a\n\nb');
  });

  it('treats a single newline as intra-paragraph whitespace', () => {
    expect(normalizeForShingling('foo\nbar baz')).toBe('foo bar baz');
  });

  it('replaces ASCII punctuation with a space but keeps hyphens', () => {
    expect(normalizeForShingling('hello, world! it is well-known.')).toBe(
      'hello world it is well-known',
    );
  });

  it('worked example: the quick brown fox', () => {
    expect(
      normalizeForShingling(
        'The quick brown fox jumps over the lazy dog. The dog barks.',
      ),
    ).toBe('the quick brown fox jumps over the lazy dog the dog barks');
  });

  it('trims leading/trailing paragraph boundaries', () => {
    expect(normalizeForShingling('\n\n\nhello\n\n\n')).toBe('hello');
  });

  it('preserves unicode letters that are not ASCII punctuation', () => {
    expect(normalizeForShingling('café naïve')).toBe('café naïve');
  });
});
