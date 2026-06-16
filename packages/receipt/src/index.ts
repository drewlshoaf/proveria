// @proveria/receipt — V1 signed JSON attestation receipt schema, builder, and
// signing helpers. Built on @proveria/crypto-core's Ed25519 + RFC 8785
// canonicalization primitives. See docs/v1 §18 and §15.3.
//
// PDF rendering (Playwright/Chromium HTML-to-PDF in the worker) lands in M8;
// the signed JSON here is the canonical artifact the PDF renders from.

export {
  RECEIPT_V1_VERSION,
  RECEIPT_PACKAGE_VERSION,
  type AttestationReceipt,
  type ReceiptSignature,
  type ReceiptSignerKind,
  type ReceiptDeviceSignatureStatus,
  type ReceiptLeafCounts,
} from './types.js';

export {
  buildAttestationReceipt,
  type BuildAttestationReceiptInput,
} from './build.js';

export {
  buildReceiptSigningDigest,
  signReceipt,
  verifyReceipt,
  type ReceiptSigningDigest,
} from './sign.js';
