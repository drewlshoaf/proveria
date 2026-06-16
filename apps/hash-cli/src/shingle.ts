// `proveria-hash shingle <path>` — produce shingle canonical_payload_hash
// values from a plain UTF-8 text file. The bytes match what the desktop
// emits for source_extraction_method='plain-text/v1'; a consumer can
// paste any of them into the verifier lookup form.
//
// Out of scope for the CLI (per docs/v1 §21): OCR, PDF extraction,
// signing, upload. Text only.

import { readFile } from 'node:fs/promises';

import {
  computeLeafHash,
  LEAF_TYPES,
} from '@proveria/crypto-core';
import {
  PRESETS,
  computeShinglePayloadHash,
  generateShingles,
  normalizeForShingling,
  tokenizeNormalized,
  type ShinglePreset,
} from '@proveria/shingling';

import type { ShingleHashRecord } from './output.js';

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export const VALID_PRESETS: readonly ShinglePreset[] = [
  'standard',
  'broad',
  'sensitive',
];

export const isShinglePreset = (s: string): s is ShinglePreset =>
  (VALID_PRESETS as readonly string[]).includes(s);

export interface ShingleOptions {
  preset?: ShinglePreset;
}

export const shingleFile = async (
  path: string,
  options: ShingleOptions = {},
): Promise<ShingleHashRecord> => {
  const preset: ShinglePreset = options.preset ?? 'standard';
  void PRESETS[preset]; // surfaces an early throw if a typo bypasses the type-guard

  const bytes = await readFile(path);
  const text = bytes.toString('utf8');
  const normalized = normalizeForShingling(text);
  const paragraphs = tokenizeNormalized(normalized);
  const tokenCount = paragraphs.reduce((s, p) => s + p.length, 0);
  const shingles = generateShingles(paragraphs, preset);

  const ctx = {
    preset,
    sourceExtractionMethod: 'plain-text/v1' as const,
  };
  const records = shingles.map((s) => {
    const payloadHash = computeShinglePayloadHash(s.text, ctx);
    const leafHash = computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.shingleSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: payloadHash,
    });
    return {
      source_index: s.sourceIndex,
      canonical_payload_hash: toHex(payloadHash),
      leaf_hash: toHex(leafHash),
    };
  });

  return {
    kind: 'shingle',
    source_path: path,
    source_extraction_method: 'plain-text/v1',
    preset,
    shingling_version: '1.0',
    normalization_version: '1.0',
    tokenizer_version: '1.0',
    hash_algorithm: 'sha256',
    protocol_version: '1.0',
    leaf_type: 'shingle/sha256/v1',
    paragraph_count: paragraphs.length,
    token_count: tokenCount,
    shingle_count: shingles.length,
    shingles: records,
  };
};
