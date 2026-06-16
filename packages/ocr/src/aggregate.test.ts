import { describe, expect, it } from 'vitest';

import { aggregatePages } from './aggregate.js';
import { OCR_V1 } from './types.js';

describe('aggregatePages', () => {
  it('computes mean confidence per page and document-wide', () => {
    const r = aggregatePages([
      { pageNumber: 1, text: 'hello world', wordConfidences: [90, 92], failed: false },
      { pageNumber: 2, text: 'second page', wordConfidences: [88, 86, 90], failed: false },
    ]);
    expect(r.pages[0]!.confidence).toBe(91);
    // (88+86+90)/3 = 88
    expect(r.pages[1]!.confidence).toBe(88);
    // (91+88)/2 = 89.5
    expect(r.summary.meanConfidence).toBe(89.5);
    expect(r.summary.lowConfidencePageCount).toBe(0);
    expect(r.summary.failedPageCount).toBe(0);
  });

  it('flags pages below the 80%% threshold as low-confidence', () => {
    const r = aggregatePages([
      { pageNumber: 1, text: 'great scan', wordConfidences: [95], failed: false },
      { pageNumber: 2, text: 'fuzzy scan', wordConfidences: [75, 60], failed: false },
    ]);
    expect(r.summary.lowConfidencePageCount).toBe(1);
    expect(r.pages[1]!.confidence).toBe(67.5);
  });

  it('treats pages with no detected words as low-confidence (null + 0 < 80)', () => {
    const r = aggregatePages([
      { pageNumber: 1, text: '', wordConfidences: [], failed: false },
    ]);
    expect(r.pages[0]!.confidence).toBeNull();
    expect(r.summary.lowConfidencePageCount).toBe(1);
    expect(r.summary.meanConfidence).toBeNull();
    expect(r.summary.failedPageCount).toBe(0);
  });

  it('separates failed pages from successful ones', () => {
    const r = aggregatePages([
      { pageNumber: 1, text: 'good', wordConfidences: [90], failed: false },
      {
        pageNumber: 2,
        text: '',
        wordConfidences: [],
        failed: true,
        errorMessage: 'engine crashed',
      },
      { pageNumber: 3, text: 'also good', wordConfidences: [85, 87], failed: false },
    ]);
    expect(r.summary.failedPageCount).toBe(1);
    expect(r.summary.ocrPageCount).toBe(2);
    // failed pages don't count toward low-confidence
    expect(r.summary.lowConfidencePageCount).toBe(0);
    expect(r.pages[1]!.errorMessage).toBe('engine crashed');
  });

  it('joins page text with form feed separators in page-number order', () => {
    // Pass in shuffled order to verify sort.
    const r = aggregatePages([
      { pageNumber: 3, text: 'gamma', wordConfidences: [90], failed: false },
      { pageNumber: 1, text: 'alpha', wordConfidences: [90], failed: false },
      { pageNumber: 2, text: 'beta', wordConfidences: [90], failed: false },
    ]);
    expect(r.combinedText).toBe('alpha\fbeta\fgamma');
  });

  it('keeps failed pages as empty strings in combinedText so page numbering survives', () => {
    const r = aggregatePages([
      { pageNumber: 1, text: 'one', wordConfidences: [90], failed: false },
      { pageNumber: 2, text: '', wordConfidences: [], failed: true },
      { pageNumber: 3, text: 'three', wordConfidences: [90], failed: false },
    ]);
    expect(r.combinedText).toBe('one\f\fthree');
  });

  it('records the locked engine identity in summary', () => {
    const r = aggregatePages([]);
    expect(r.summary.engine).toBe(OCR_V1.engine);
    expect(r.summary.engineVersion).toBe(OCR_V1.engineVersion);
    expect(r.summary.languagePack).toBe(OCR_V1.languagePack);
    expect(r.summary.languagePackVersion).toBe(OCR_V1.languagePackVersion);
  });

  it('propagates document-level warnings', () => {
    const r = aggregatePages([], { warnings: ['engine_init_failed'] });
    expect(r.summary.warnings).toEqual(['engine_init_failed']);
  });
});
