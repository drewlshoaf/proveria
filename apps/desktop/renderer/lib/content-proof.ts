export type ContentProofSourceExtractionMethod =
  | 'plain-text/v1'
  | 'pdf-text-layer/v1'
  | 'ocr-tesseract/v1';

export interface RendererOcrSummary {
  engine: 'tesseract';
  engineVersion: string;
  languagePack: 'eng';
  languagePackVersion: string;
  pageCount: number;
  ocrPageCount: number;
  failedPageCount: number;
  lowConfidencePageCount: number;
  meanConfidence: number | null;
  warnings: string[];
}

export interface RendererContentProof {
  preset: 'standard';
  sourceExtractionMethod: ContentProofSourceExtractionMethod;
  normalizedTokenCount: number;
  shingles: Array<{
    sourceIndex: number;
    canonicalPayloadHash: string;
  }>;
  ocrSummary?: RendererOcrSummary;
}

export interface RendererExactImageProof {
  method: 'exact-image-sha256/v1';
  mediaType: 'image/png' | 'image/jpeg';
}

export const buildContentProofRpcPayload = (
  contentProof: RendererContentProof | undefined,
): { contentProof?: RendererContentProof } => {
  if (!contentProof) return {};
  return {
    contentProof: {
      preset: contentProof.preset,
      sourceExtractionMethod: contentProof.sourceExtractionMethod,
      normalizedTokenCount: contentProof.normalizedTokenCount,
      shingles: contentProof.shingles,
      ...(contentProof.ocrSummary
        ? { ocrSummary: contentProof.ocrSummary }
        : {}),
    },
  };
};

export const buildExactImageProofRpcPayload = (
  exactImageProof: RendererExactImageProof | undefined,
): { exactImageProof?: RendererExactImageProof } => {
  if (!exactImageProof) return {};
  return { exactImageProof };
};
