// Shingle hash construction (docs/protocol/v1/shingling-v1.md §6).
//
// Binary canonical_shingle_payload:
//
//   0x02                                                 (1 byte, shingle domain sep)
//   uint32be(len(shingling_version_utf8))   || bytes
//   uint32be(len(preset_utf8))              || bytes
//   uint32be(len(normalization_version_utf8))|| bytes
//   uint32be(len(tokenizer_version_utf8))   || bytes
//   uint32be(len(source_extraction_method_utf8))|| bytes
//   uint32be(len(window_text_utf8))         || bytes
//
// canonical_payload_hash = SHA-256(canonical_shingle_payload)  (32 bytes)
//
// Then the standard Protocol V1 §4.1 leaf hash input with
// leaf_type = "shingle/sha256/v1" produces the leaf_hash that goes into the
// Merkle tree.

import { createHash } from 'node:crypto';

import { computeLeafHash, LEAF_TYPES } from '@proveria/crypto-core';

import {
  SHINGLING_V1_VERSIONS,
  type ShinglePreset,
  type SourceExtractionMethod,
} from './types.js';

const TEXT_ENCODER = new TextEncoder();

export interface ShingleHashContext {
  preset: ShinglePreset;
  sourceExtractionMethod: SourceExtractionMethod;
}

const lengthPrefix = (length: number): Uint8Array => {
  if (length < 0 || length > 0xffffffff) {
    throw new Error(`length out of uint32 range: ${length}`);
  }
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, length, false /* big-endian */);
  return buf;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

const tagged = (s: string): Uint8Array[] => {
  const bytes = TEXT_ENCODER.encode(s);
  return [lengthPrefix(bytes.length), bytes];
};

/** Build the binary canonical_shingle_payload per §6. */
export const buildShinglePayload = (
  windowText: string,
  ctx: ShingleHashContext,
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

/** canonical_payload_hash = SHA-256(canonical_shingle_payload). */
export const computeShinglePayloadHash = (
  windowText: string,
  ctx: ShingleHashContext,
): Uint8Array =>
  new Uint8Array(
    createHash('sha256').update(buildShinglePayload(windowText, ctx)).digest(),
  );

/**
 * Full Merkle leaf hash for a shingle — Protocol V1 §4.1 with
 * leaf_type = "shingle/sha256/v1" and canonical_payload_hash from §6.
 */
export const computeShingleLeafHash = (
  windowText: string,
  ctx: ShingleHashContext,
): Uint8Array =>
  computeLeafHash({
    protocolVersion: '1.0',
    leafType: LEAF_TYPES.shingleSha256V1,
    hashAlgorithm: 'sha256',
    canonicalPayloadHash: computeShinglePayloadHash(windowText, ctx),
  });
