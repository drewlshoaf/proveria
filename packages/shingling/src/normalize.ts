// Text normalization for V1 shingling (docs/protocol/v1/shingling-v1.md §3).
//
// The output is a UTF-8 string of one or more paragraphs separated by
// exactly "\n\n", each paragraph being non-empty lowercase tokens separated
// by single ASCII spaces. The function is pure + deterministic.

const SMART_PUNCT_MAP: Record<string, string> = {
  '‘': "'", // ‘ left single
  '’': "'", // ’ right single
  '“': '"', // “ left double
  '”': '"', // ” right double
  '–': '-', // – en dash
  '—': '-', // — em dash
  '…': '...', // … horizontal ellipsis
};

const LIGATURE_MAP: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
};

const replaceMap = (s: string, m: Record<string, string>): string => {
  let out = s;
  for (const [from, to] of Object.entries(m)) {
    out = out.split(from).join(to);
  }
  return out;
};

// Splits the document into paragraphs on any run of 2+ line breaks
// (possibly with intra-break whitespace). Single intra-paragraph newlines
// stay inside their paragraph and are handled per-paragraph below.
const PARAGRAPH_SPLIT_RE = /(?:[ \t\r\v\f]*\n[ \t\r\v\f]*){2,}/g;
// ASCII punctuation that becomes a space. Excludes a-z, 0-9, hyphen `-`,
// and space.
const PUNCT_RE = /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~]/g;

/** Normalize a raw input string per §3 of shingling-v1. */
export const normalizeForShingling = (raw: string): string => {
  // 1. NFC + 2. lowercase
  let s = raw.normalize('NFC').toLowerCase();
  // 3. Smart punctuation → ASCII
  s = replaceMap(s, SMART_PUNCT_MAP);
  // 4. Ligatures
  s = replaceMap(s, LIGATURE_MAP);
  // 5. Soft hyphen removal
  s = s.replace(/­/g, '');
  // 6. De-hyphenate line-broken words: hyphen + newline (+ optional space)
  //    → joined to nothing.
  s = s.replace(/-\n[ \t]*/g, '');
  // 7. Form feed → paragraph boundary
  s = s.replace(/\f/g, '\n\n');
  // 8–11. Split on paragraph boundaries; per paragraph turn single newlines
  // into spaces, ASCII punctuation → space, collapse whitespace runs, trim.
  // Empty paragraphs drop out.
  const paragraphs = s.split(PARAGRAPH_SPLIT_RE).map((p) =>
    p
      .replace(/\n/g, ' ') // intra-paragraph wrapping
      .replace(PUNCT_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return paragraphs.filter((p) => p.length > 0).join('\n\n');
};
