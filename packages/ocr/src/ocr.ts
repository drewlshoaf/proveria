// runOcr — orchestrate Tesseract.js across a set of pre-rendered page images.
//
// Why "pre-rendered images" as input rather than raw PDF bytes? Rendering a
// PDF page to a raster image needs a canvas backend, and the canvas-on-Node
// libraries (node-canvas, @napi-rs/canvas) reintroduce the native-binary
// distribution risk we explicitly ducked when we picked tesseract.js (WASM)
// for V1. Instead, the desktop renders pages with pdfjs-dist inside Electron,
// where browser canvas is available natively — and hands the bitmaps here.
//
// runOcr is also injection-friendly via the `recognize` option so tests can
// exercise the orchestration + aggregation logic without loading the WASM.

import { aggregatePages, type PageInput } from './aggregate.js';
import { OCR_V1, type OcrResult } from './types.js';

/** Per-page tesseract output shape we care about. */
export interface RecognizePageOutput {
  text: string;
  /** Per-word confidences in 0..100. */
  wordConfidences: number[];
}

export type RecognizeFn = (
  imageBytes: Uint8Array,
  language: string,
) => Promise<RecognizePageOutput>;

export interface RunOcrOptions {
  /** Override the OCR backend. Defaults to a tesseract.js-backed implementation. */
  recognize?: RecognizeFn;
  /** Language pack to load. Defaults to 'eng' (V1 spec §2). */
  language?: string;
}

/**
 * Run OCR over a series of page images, in page-number order (image index 0
 * is page 1). Failures are caught per-page; one page blowing up doesn't lose
 * the rest of the document.
 */
export const runOcr = async (
  pageImages: Uint8Array[],
  options: RunOcrOptions = {},
): Promise<OcrResult> => {
  const recognize = options.recognize ?? defaultRecognize;
  const language = options.language ?? OCR_V1.languagePack;
  const warnings: string[] = [];

  const inputs: PageInput[] = [];
  for (let i = 0; i < pageImages.length; i += 1) {
    const pageNumber = i + 1;
    try {
      const out = await recognize(pageImages[i]!, language);
      inputs.push({
        pageNumber,
        text: out.text,
        wordConfidences: out.wordConfidences,
        failed: false,
      });
    } catch (err) {
      inputs.push({
        pageNumber,
        text: '',
        wordConfidences: [],
        failed: true,
        errorMessage: (err as Error).message,
      });
    }
  }

  return aggregatePages(inputs, { warnings });
};

// --- default tesseract.js-backed recognizer -------------------------------
//
// Imported lazily so callers that only need the aggregation logic (tests,
// metadata-only paths) don't pay the WASM-init cost on first import.

let cachedRecognize: RecognizeFn | null = null;

const defaultRecognize: RecognizeFn = async (imageBytes, language) => {
  if (!cachedRecognize) cachedRecognize = await buildTesseractRecognize();
  return cachedRecognize(imageBytes, language);
};

const buildTesseractRecognize = async (): Promise<RecognizeFn> => {
  // tesseract.js is CJS, so dynamic `import()` wraps its module.exports
  // under .default. Fall back to the namespace itself in case Node's ESM
  // interop ever lifts named exports for this package.
  const mod = (await import('tesseract.js')) as unknown as {
    default?: { recognize: TesseractRecognize };
    recognize?: TesseractRecognize;
  };
  const recognize = mod.default?.recognize ?? mod.recognize;
  if (!recognize) {
    throw new Error('tesseract.js does not expose a recognize() function');
  }
  return async (imageBytes, language) => {
    const buf = Buffer.from(imageBytes);
    const { data } = await recognize(buf, language);
    const wordConfidences = (data.words ?? [])
      .map((w) => w.confidence)
      .filter((c): c is number => typeof c === 'number');
    return { text: data.text, wordConfidences };
  };
};

type TesseractRecognize = (
  image: unknown,
  lang: string,
) => Promise<{
  data: {
    text: string;
    words?: Array<{ confidence?: number }>;
  };
}>;
