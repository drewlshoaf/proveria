// Browser-safe shingling helpers.
//
// This module intentionally avoids node:crypto and @proveria/crypto-core so it
// can run inside the desktop renderer or the thin verifier web client.

import { normalizeForShingling } from './normalize.js';
import { generateShingles, type Shingle } from './shingle.js';
import { tokenizeNormalized } from './tokenize.js';
import { SHINGLING_V1_VERSIONS, type ShinglePreset, type SourceExtractionMethod } from './types.js';

const TEXT_ENCODER = new TextEncoder();

export { normalizeForShingling } from './normalize.js';
export { tokenizeNormalized } from './tokenize.js';

export interface BrowserShingleHashContext {
  preset: ShinglePreset;
  sourceExtractionMethod: SourceExtractionMethod;
}

export interface BrowserShingleHash {
  sourceIndex: number;
  canonicalPayloadHash: string;
}

export interface BrowserShinglingResult {
  normalizedTokenCount: number;
  shingleCount: number;
  shingles: BrowserShingleHash[];
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const lengthPrefix = (length: number): Uint8Array => {
  if (length < 0 || length > 0xffffffff) {
    throw new Error(`length out of uint32 range: ${length}`);
  }
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, length, false);
  return buf;
};

const tagged = (value: string): Uint8Array[] => {
  const bytes = TEXT_ENCODER.encode(value);
  return [lengthPrefix(bytes.length), bytes];
};

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const buildBrowserShinglePayload = (
  windowText: string,
  ctx: BrowserShingleHashContext,
): Uint8Array =>
  concat([
    new Uint8Array([0x02]),
    ...tagged(SHINGLING_V1_VERSIONS.shingling_version),
    ...tagged(ctx.preset),
    ...tagged(SHINGLING_V1_VERSIONS.normalization_version),
    ...tagged(SHINGLING_V1_VERSIONS.tokenizer_version),
    ...tagged(ctx.sourceExtractionMethod),
    ...tagged(windowText),
  ]);

export const computeBrowserShinglePayloadHash = async (
  windowText: string,
  ctx: BrowserShingleHashContext,
): Promise<string> => {
  const payload = buildBrowserShinglePayload(windowText, ctx);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    ) as ArrayBuffer,
  );
  return toHex(new Uint8Array(digest));
};

export const shinglePlainTextInBrowser = async (
  text: string,
  ctx: BrowserShingleHashContext = {
    preset: 'standard',
    sourceExtractionMethod: 'plain-text/v1',
  },
): Promise<BrowserShinglingResult> => {
  const normalized = normalizeForShingling(text);
  const paragraphs = tokenizeNormalized(normalized);
  const shingles: Shingle[] = generateShingles(paragraphs, ctx.preset);
  const hashedWithPossibleDuplicates = await Promise.all(
    shingles.map(async (shingle) => ({
      sourceIndex: shingle.sourceIndex,
      canonicalPayloadHash: await computeBrowserShinglePayloadHash(
        shingle.text,
        ctx,
      ),
    })),
  );
  const seen = new Set<string>();
  const hashed = hashedWithPossibleDuplicates.filter((shingle) => {
    if (seen.has(shingle.canonicalPayloadHash)) return false;
    seen.add(shingle.canonicalPayloadHash);
    return true;
  });
  return {
    normalizedTokenCount: paragraphs.reduce(
      (count, paragraph) => count + paragraph.length,
      0,
    ),
    shingleCount: hashed.length,
    shingles: hashed,
  };
};
