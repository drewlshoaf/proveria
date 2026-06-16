// Shingle generation for V1 (docs/protocol/v1/shingling-v1.md §5).
//
// Given the token paragraphs (output of tokenizeNormalized) and a preset,
// slide a window of `preset.window` tokens by `preset.stride` per step.
// Shingles do NOT cross paragraph boundaries; paragraphs shorter than the
// window contribute zero shingles for that preset.

import { PRESETS, type ShinglePreset } from './types.js';

export interface Shingle {
  /** 0-indexed position within the source document (across all paragraphs). */
  sourceIndex: number;
  /** Tokens joined by a single ASCII space — the window text §6 hashes. */
  text: string;
}

export const generateShingles = (
  paragraphs: readonly string[][],
  preset: ShinglePreset,
): Shingle[] => {
  const { window, stride } = PRESETS[preset];
  if (window <= 0 || stride <= 0) {
    throw new Error(`invalid preset ${preset}: ${JSON.stringify(PRESETS[preset])}`);
  }
  const out: Shingle[] = [];
  let sourceIndex = 0;
  for (const tokens of paragraphs) {
    if (tokens.length < window) continue;
    for (let i = 0; i + window <= tokens.length; i += stride) {
      out.push({
        sourceIndex,
        text: tokens.slice(i, i + window).join(' '),
      });
      sourceIndex += 1;
    }
  }
  return out;
};
