import { describe, expect, it } from 'vitest';

import { buildContentProofRpcPayload } from './content-proof';

describe('buildContentProofRpcPayload', () => {
  it('preserves native PDF extraction metadata', () => {
    const payload = buildContentProofRpcPayload({
      preset: 'standard',
      sourceExtractionMethod: 'pdf-text-layer/v1',
      normalizedTokenCount: 42,
      shingles: [
        {
          sourceIndex: 7,
          canonicalPayloadHash:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    });

    expect(payload.contentProof?.sourceExtractionMethod).toBe(
      'pdf-text-layer/v1',
    );
  });

  it('preserves OCR extraction metadata', () => {
    const payload = buildContentProofRpcPayload({
      preset: 'standard',
      sourceExtractionMethod: 'ocr-tesseract/v1',
      normalizedTokenCount: 42,
      shingles: [
        {
          sourceIndex: 7,
          canonicalPayloadHash:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
      ocrSummary: {
        engine: 'tesseract',
        engineVersion: '7.0.0',
        languagePack: 'eng',
        languagePackVersion: '4.1.0',
        pageCount: 2,
        ocrPageCount: 2,
        failedPageCount: 0,
        lowConfidencePageCount: 1,
        meanConfidence: 82.5,
        warnings: [],
      },
    });

    expect(payload.contentProof?.sourceExtractionMethod).toBe(
      'ocr-tesseract/v1',
    );
    expect(payload.contentProof?.ocrSummary?.lowConfidencePageCount).toBe(1);
  });
});
