import { describe, expect, it } from 'vitest';

import { runOcr, type RecognizeFn } from './ocr.js';

const fakeRecognize =
  (pages: { text: string; wordConfidences: number[] }[]): RecognizeFn =>
  async (_image, _lang) => {
    const out = pages.shift();
    if (!out) throw new Error('fake recognizer ran out of pages');
    return out;
  };

describe('runOcr', () => {
  it('runs the recognizer per image and aggregates the result', async () => {
    const images = [new Uint8Array([1]), new Uint8Array([2])];
    const result = await runOcr(images, {
      recognize: fakeRecognize([
        { text: 'page one', wordConfidences: [90, 92] },
        { text: 'page two', wordConfidences: [85, 88] },
      ]),
    });
    expect(result.summary.pageCount).toBe(2);
    expect(result.summary.failedPageCount).toBe(0);
    expect(result.combinedText).toBe('page one\fpage two');
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
  });

  it('catches per-page failures without dropping the document', async () => {
    const images = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    const recognize: RecognizeFn = async (img, _lang) => {
      if (img[0] === 2) throw new Error('synthetic page 2 failure');
      return { text: `page ${img[0]}`, wordConfidences: [90] };
    };
    const result = await runOcr(images, { recognize });
    expect(result.summary.pageCount).toBe(3);
    expect(result.summary.failedPageCount).toBe(1);
    expect(result.pages[1]!.failed).toBe(true);
    expect(result.pages[1]!.errorMessage).toBe('synthetic page 2 failure');
    expect(result.combinedText).toBe('page 1\f\fpage 3');
  });

  it('passes the language option to the recognizer', async () => {
    let observedLang = '';
    const recognize: RecognizeFn = async (_img, lang) => {
      observedLang = lang;
      return { text: 'x', wordConfidences: [90] };
    };
    await runOcr([new Uint8Array([1])], { recognize, language: 'eng+osd' });
    expect(observedLang).toBe('eng+osd');
  });

  it('defaults language to "eng"', async () => {
    let observedLang = '';
    const recognize: RecognizeFn = async (_img, lang) => {
      observedLang = lang;
      return { text: 'x', wordConfidences: [90] };
    };
    await runOcr([new Uint8Array([1])], { recognize });
    expect(observedLang).toBe('eng');
  });
});
