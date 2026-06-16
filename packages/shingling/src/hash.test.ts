import { describe, it, expect } from 'vitest';

import { computeLeafHash, LEAF_TYPES } from '@proveria/crypto-core';

import {
  buildShinglePayload,
  computeShingleLeafHash,
  computeShinglePayloadHash,
} from './hash.js';

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const ctx = {
  preset: 'standard' as const,
  sourceExtractionMethod: 'plain-text/v1' as const,
};

const WINDOW_0 = 'the quick brown fox jumps over the';

describe('buildShinglePayload (§6 byte layout)', () => {
  it('starts with the shingle domain separator 0x02', () => {
    const bytes = buildShinglePayload(WINDOW_0, ctx);
    expect(bytes[0]).toBe(0x02);
  });

  it('produces the exact byte length predicted by the spec', () => {
    // 1 (domain) + 4+3 (shingling_version "1.0")
    //            + 4+8 (preset "standard")
    //            + 4+3 (normalization_version "1.0")
    //            + 4+3 (tokenizer_version "1.0")
    //            + 4+13 (source_extraction_method "plain-text/v1", 13 chars)
    //            + 4+34 (window text, 34 bytes ASCII)
    //  = 1 + 7 + 12 + 7 + 7 + 17 + 38 = 89 bytes.
    expect(buildShinglePayload(WINDOW_0, ctx)).toHaveLength(89);
  });

  it('changes when any context field changes', () => {
    const base = buildShinglePayload(WINDOW_0, ctx);
    const otherPreset = buildShinglePayload(WINDOW_0, {
      ...ctx,
      preset: 'broad',
    });
    const otherSource = buildShinglePayload(WINDOW_0, {
      ...ctx,
      sourceExtractionMethod: 'pdf-text-layer/v1',
    });
    expect(Buffer.from(otherPreset)).not.toEqual(Buffer.from(base));
    expect(Buffer.from(otherSource)).not.toEqual(Buffer.from(base));
  });

  // ocr-v1.md §11 — the OCR source tag is 16 bytes ("ocr-tesseract/v1").
  // If anyone renames the tag, the canonical payload bytes for every OCR
  // shingle change, breaking matches across all existing receipts. The
  // assertions below fail loud rather than silently change the wire format.
  it('encodes source_extraction_method "ocr-tesseract/v1" at the exact byte offset', () => {
    const ocrCtx = {
      preset: 'standard' as const,
      sourceExtractionMethod: 'ocr-tesseract/v1' as const,
    };
    const bytes = buildShinglePayload(WINDOW_0, ocrCtx);
    // Offset of source_extraction_method field within the payload:
    //   1 (0x02 sep)
    // + 4 + 3  shingling_version "1.0"
    // + 4 + 8  preset "standard"
    // + 4 + 3  normalization_version "1.0"
    // + 4 + 3  tokenizer_version "1.0"
    // = 34
    const fieldStart = 34;
    // uint32be length prefix = 16
    expect(bytes[fieldStart + 0]).toBe(0x00);
    expect(bytes[fieldStart + 1]).toBe(0x00);
    expect(bytes[fieldStart + 2]).toBe(0x00);
    expect(bytes[fieldStart + 3]).toBe(0x10);
    const tag = Buffer.from(bytes.slice(fieldStart + 4, fieldStart + 4 + 16))
      .toString('utf8');
    expect(tag).toBe('ocr-tesseract/v1');
  });

  it('OCR shingle bytes differ from native-text bytes for the same window', () => {
    const native = buildShinglePayload(WINDOW_0, ctx); // plain-text/v1
    const ocr = buildShinglePayload(WINDOW_0, {
      preset: 'standard',
      sourceExtractionMethod: 'ocr-tesseract/v1',
    });
    expect(Buffer.from(native).equals(Buffer.from(ocr))).toBe(false);
  });
});

describe('computeShinglePayloadHash', () => {
  it('returns 32 bytes', () => {
    expect(computeShinglePayloadHash(WINDOW_0, ctx)).toHaveLength(32);
  });

  it('is deterministic for the same input', () => {
    const a = computeShinglePayloadHash(WINDOW_0, ctx);
    const b = computeShinglePayloadHash(WINDOW_0, ctx);
    expect(toHex(a)).toBe(toHex(b));
  });

  it('different window text → different hash', () => {
    const a = computeShinglePayloadHash(WINDOW_0, ctx);
    const b = computeShinglePayloadHash('something else entirely', ctx);
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('computeShingleLeafHash', () => {
  it('matches computeLeafHash with leaf_type "shingle/sha256/v1"', () => {
    const payloadHash = computeShinglePayloadHash(WINDOW_0, ctx);
    const direct = computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.shingleSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: payloadHash,
    });
    const indirect = computeShingleLeafHash(WINDOW_0, ctx);
    expect(toHex(indirect)).toBe(toHex(direct));
  });
});
