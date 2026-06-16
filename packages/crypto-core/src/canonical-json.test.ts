import { describe, it, expect } from 'vitest';
import { canonicalize, canonicalizeToString } from './canonical-json.js';
import { hex, loadVectorFile } from './test-vectors.js';

interface CanonicalJsonVectorFile {
  vectors: Array<{
    name: string;
    input: unknown;
    expected: { canonicalUtf8: string; canonicalUtf8Hex: string };
  }>;
}

const file = loadVectorFile<CanonicalJsonVectorFile>('canonical-json');

describe('canonical-json — spec vectors', () => {
  for (const v of file.vectors) {
    it(v.name, () => {
      const bytes = canonicalize(v.input);
      expect(hex(bytes)).toBe(v.expected.canonicalUtf8Hex);
      expect(Buffer.from(bytes).toString('utf8')).toBe(
        v.expected.canonicalUtf8,
      );
    });
  }
});

describe('canonical-json — behavior', () => {
  it('sorts object keys by UTF-16 code units', () => {
    expect(canonicalizeToString({ b: 1, a: 2, c: 3 })).toBe(
      '{"a":2,"b":1,"c":3}',
    );
  });

  it('sorts non-BMP keys by UTF-16 code units, not code point (RFC 8785 §3.2.3)', () => {
    // U+1F600 (an emoji) is the UTF-16 surrogate pair 0xD83D 0xDE00; U+E000
    // is the single code unit 0xE000. By UTF-16 code-unit order 0xD83D <
    // 0xE000, so the emoji key sorts first. By code-point order (0x1F600 >
    // 0xE000) it would sort last — the exact divergence RFC 8785 pins down.
    const emojiKey = String.fromCodePoint(0x1f600);
    const bmpKey = String.fromCharCode(0xe000);
    const out = canonicalizeToString({ [bmpKey]: 1, [emojiKey]: 2 });
    expect(out).toBe(
      `{${JSON.stringify(emojiKey)}:2,${JSON.stringify(bmpKey)}:1}`,
    );
  });

  it('recurses into nested objects + arrays', () => {
    expect(
      canonicalizeToString({ z: [{ y: 1, x: 2 }], a: null }),
    ).toBe('{"a":null,"z":[{"x":2,"y":1}]}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ x: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalize({ x: -Infinity })).toThrow(/non-finite/);
    expect(() => canonicalize({ x: NaN })).toThrow(/non-finite/);
  });

  it('rejects non-integer and non-safe-integer numbers (§2 rule 1)', () => {
    expect(() => canonicalize({ x: 1.5 })).toThrow(/non-integer/);
    expect(() => canonicalize({ x: 0.1 })).toThrow(/non-integer/);
    expect(() => canonicalize({ x: 2 ** 53 })).toThrow(/non-safe-integer/);
    // Safe integers (including 0 and negatives) are fine.
    expect(canonicalizeToString({ x: 0 })).toBe('{"x":0}');
    expect(canonicalizeToString({ x: -42 })).toBe('{"x":-42}');
  });

  it('rejects undefined', () => {
    expect(() => canonicalize(undefined)).toThrow(/undefined/);
  });

  it('produces deterministic output regardless of input key order', () => {
    const a = canonicalize({ one: 1, two: 2, three: 3 });
    const b = canonicalize({ three: 3, one: 1, two: 2 });
    expect(hex(a)).toBe(hex(b));
  });
});
