// V1 OCR types — see docs/protocol/v1/ocr-v1.md.

/** Pinned engine identity. The `v1` in `ocr-tesseract/v1` covers this combo. */
export const OCR_V1 = {
  /** Bumped only when ocr-v1.md changes shape. */
  ocrExtractionVersion: '1.0',
  /** The source_extraction_method string baked into the canonical shingle bytes. */
  sourceExtractionMethod: 'ocr-tesseract/v1' as const,
  engine: 'tesseract' as const,
  /** Tesseract.js npm version — keep in sync with package.json's dep range. */
  engineVersion: '7.0.0',
  languagePack: 'eng' as const,
  /** Identifier of the bundled traineddata file. */
  languagePackVersion: '4.1.0',
} as const;

/** Spec §4 low-confidence threshold. */
export const LOW_CONFIDENCE_THRESHOLD = 80;

/** Spec §3 OCR fallback trigger: PDF text-layer with < this many normalized tokens. */
export const PDF_TEXT_LAYER_MIN_TOKENS = 50;

export interface OcrPage {
  /** 1-based page number. */
  pageNumber: number;
  /** Extracted text. Empty string for failed pages. */
  text: string;
  /** Mean word confidence in [0..100]. Null if no words were detected. */
  confidence: number | null;
  failed: boolean;
  /** Free-form failure reason for human surfaces. Never crosses the network. */
  errorMessage?: string;
}

/** Plaintext-safe document-level summary. Only this and `combinedText` leave runOcr. */
export interface OcrSummary {
  engine: typeof OCR_V1.engine;
  engineVersion: string;
  languagePack: typeof OCR_V1.languagePack;
  languagePackVersion: string;
  pageCount: number;
  ocrPageCount: number;
  failedPageCount: number;
  lowConfidencePageCount: number;
  /** Unweighted arithmetic mean of per-page mean confidences. Null if no page had any text. */
  meanConfidence: number | null;
  warnings: string[];
}

export interface OcrResult {
  pages: OcrPage[];
  /** Pages joined in page-number order with form feed (`\f`) separators per spec §3. */
  combinedText: string;
  summary: OcrSummary;
}
