// Plaintext-safe page → document aggregation. Pure function; takes per-page
// outputs (text + word-confidences) and produces the OcrResult including the
// shingling-ready combinedText. Kept separate from runOcr so the spec §4-§5
// logic is unit-testable without invoking the WASM engine.

import {
  LOW_CONFIDENCE_THRESHOLD,
  OCR_V1,
  type OcrPage,
  type OcrResult,
  type OcrSummary,
} from './types.js';

export interface PageInput {
  pageNumber: number;
  /** Raw text from the engine for this page. */
  text: string;
  /** Per-word confidences from the engine, 0..100. Empty if no words. */
  wordConfidences: number[];
  /** True if the engine threw for this page; text MUST be empty when so. */
  failed: boolean;
  errorMessage?: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const meanOrNull = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

export const aggregatePages = (
  inputs: PageInput[],
  opts: { warnings?: string[] } = {},
): OcrResult => {
  const pages: OcrPage[] = inputs
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((p) => {
      const conf = meanOrNull(p.wordConfidences);
      const page: OcrPage = {
        pageNumber: p.pageNumber,
        text: p.failed ? '' : p.text,
        confidence: conf === null ? null : round1(conf),
        failed: p.failed,
      };
      if (p.errorMessage) page.errorMessage = p.errorMessage;
      return page;
    });

  // Pages with NO words detected get confidence 0 (spec §4) and are treated
  // as low-confidence. We keep `confidence: null` in the page record so the
  // distinction "engine ran but found nothing" vs "page failed entirely"
  // survives — but for the low-confidence count, null counts as 0 < 80.
  const lowConfidencePageCount = pages.filter(
    (p) => !p.failed && (p.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  const failedPageCount = pages.filter((p) => p.failed).length;
  const ocrPageCount = pages.length - failedPageCount;

  const confidences = pages
    .filter((p) => !p.failed && p.confidence !== null)
    .map((p) => p.confidence as number);
  const docMean = meanOrNull(confidences);

  const summary: OcrSummary = {
    engine: OCR_V1.engine,
    engineVersion: OCR_V1.engineVersion,
    languagePack: OCR_V1.languagePack,
    languagePackVersion: OCR_V1.languagePackVersion,
    pageCount: pages.length,
    ocrPageCount,
    failedPageCount,
    lowConfidencePageCount,
    meanConfidence: docMean === null ? null : round1(docMean),
    warnings: opts.warnings ?? [],
  };

  // §3 step 5: pages concatenated in page-number order, separated by \f.
  // Form feed becomes a paragraph boundary in shingling-v1.md §3 step 7.
  // Failed pages still occupy a slot — they contribute an empty string +
  // a form feed, so a 3-page document with page 2 failed becomes
  // "<page1>\f\f<page3>".
  const combinedText = pages.map((p) => p.text).join('\f');

  return { pages, combinedText, summary };
};
