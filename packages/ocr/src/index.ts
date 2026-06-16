// @proveria/ocr — V1 OCR for scanned PDFs per docs/protocol/v1/ocr-v1.md.
//
// Producers (desktop) run this on PDFs whose pdfjs-dist text-layer extraction
// yielded too little text (spec §3 trigger). Output combinedText feeds into
// @proveria/shingling with source_extraction_method='ocr-tesseract/v1' so the
// canonical shingle bytes are engine-pinned and consumer-reproducible.
//
// OCR plaintext lives in process memory only — never disk, never network.

export {
  OCR_V1,
  LOW_CONFIDENCE_THRESHOLD,
  PDF_TEXT_LAYER_MIN_TOKENS,
  type OcrPage,
  type OcrResult,
  type OcrSummary,
} from './types.js';

export { aggregatePages, type PageInput } from './aggregate.js';

export {
  runOcr,
  type RecognizeFn,
  type RecognizePageOutput,
  type RunOcrOptions,
} from './ocr.js';

export { renderPdfPages, type RenderPdfOptions } from './pdf-render.js';
