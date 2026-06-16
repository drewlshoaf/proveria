import { describe, it, expect } from 'vitest';

import {
  RECEIPT_PACKAGE_VERSION,
  RECEIPT_V1_VERSION,
  buildAttestationReceipt,
  buildReceiptSigningDigest,
  signReceipt,
  verifyReceipt,
} from './index.js';

describe('@proveria/receipt — public surface', () => {
  it('exports a semver package version', () => {
    expect(RECEIPT_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports the V1 receipt version + the build/sign/verify helpers', () => {
    expect(RECEIPT_V1_VERSION).toBe('1.0');
    expect(typeof buildAttestationReceipt).toBe('function');
    expect(typeof buildReceiptSigningDigest).toBe('function');
    expect(typeof signReceipt).toBe('function');
    expect(typeof verifyReceipt).toBe('function');
  });
});
