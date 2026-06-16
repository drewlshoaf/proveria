// Tokenization for V1 shingling (docs/protocol/v1/shingling-v1.md §4).
//
// Input: normalized text (output of normalizeForShingling).
// Output: an array of paragraphs, each paragraph being an array of tokens.
// A token is a non-empty substring between ASCII spaces; hyphens stay inside
// tokens so "well-known" stays one token.

export const tokenizeNormalized = (normalized: string): string[][] => {
  if (normalized.length === 0) return [];
  return normalized
    .split('\n\n')
    .map((paragraph) => paragraph.split(' ').filter((t) => t.length > 0));
};
