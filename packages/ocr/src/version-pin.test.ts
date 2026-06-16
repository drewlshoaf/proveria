import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { OCR_V1 } from './types.js';

const require = createRequire(import.meta.url);

// The OCR spec (ocr-v1.md §2) ties the source_extraction_method tag to a
// pinned tesseract.js version + traineddata version. If someone bumps the
// dep range without updating OCR_V1.engineVersion, the canonical shingle
// bytes silently start encoding a different engine identity than what's
// actually running — exactly the drift the spec exists to prevent. This
// test fails loudly when that happens.
describe('OCR engine version pin', () => {
  it('OCR_V1.engineVersion matches the installed tesseract.js version', () => {
    const pkg = require('tesseract.js/package.json') as { version: string };
    expect(OCR_V1.engineVersion).toBe(pkg.version);
  });
});
