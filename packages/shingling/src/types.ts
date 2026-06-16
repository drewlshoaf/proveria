// V1 shingling types (docs/protocol/v1/shingling-v1.md).

export type ShinglePreset = 'standard' | 'broad' | 'sensitive';

export type SourceExtractionMethod =
  | 'plain-text/v1'
  | 'pdf-text-layer/v1'
  | 'ocr-tesseract/v1';

export interface PresetSpec {
  /** Number of tokens per shingle. */
  window: number;
  /** Token positions advanced between consecutive shingles. */
  stride: number;
}

/** V1 preset table per §5. */
export const PRESETS: Record<ShinglePreset, PresetSpec> = {
  standard: { window: 7, stride: 1 },
  broad: { window: 12, stride: 3 },
  sensitive: { window: 4, stride: 1 },
} as const;

/** V1 fixed version field values per §1. */
export const SHINGLING_V1_VERSIONS = {
  shingling_version: '1.0',
  normalization_version: '1.0',
  tokenizer_version: '1.0',
} as const;

export const SHINGLING_PACKAGE_VERSION = '0.0.0';
