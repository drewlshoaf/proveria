import { createHash } from 'node:crypto';

import {
  shinglePlainTextInBrowser,
  type BrowserShinglingResult,
} from '@proveria/shingling/browser';
import type { ShinglePreset, SourceExtractionMethod } from '@proveria/shingling';

export type HashInput = string | ArrayBuffer | Uint8Array;

export const sha256Hex = (input: HashInput): string => {
  const hash = createHash('sha256');
  if (typeof input === 'string') {
    hash.update(input);
  } else {
    hash.update(new Uint8Array(input));
  }
  return hash.digest('hex');
};

export interface PassageProofHashOptions {
  preset?: ShinglePreset;
  sourceExtractionMethod?: SourceExtractionMethod;
}

export interface PassageProofHash extends BrowserShinglingResult {
  hashes: string[];
}

export const passageProofHashes = async (
  text: string,
  options: PassageProofHashOptions = {},
): Promise<PassageProofHash> => {
  const result = await shinglePlainTextInBrowser(text, {
    preset: options.preset ?? 'standard',
    sourceExtractionMethod: options.sourceExtractionMethod ?? 'plain-text/v1',
  });
  return {
    ...result,
    hashes: result.shingles.map((shingle) => shingle.canonicalPayloadHash),
  };
};
