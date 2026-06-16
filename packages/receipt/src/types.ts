// V1 JSON attestation receipt schema (docs/v1 §18).
//
// The receipt is the canonical evidence artifact issued when an attestation
// confirms. The PDF (M8) renders from it. Canonicalized per RFC 8785;
// embedded hashes are lowercase hex.
//
// PROVISIONAL: this schema is subject to the external cryptographic review
// that gates the M4/M5 pilot. Treat field names + signing payload as not yet
// frozen.

export type ReceiptSignerKind = 'proveria' | 'customer';

/** A signature over the receipt's §18 signing digest. signature is base64url. */
export interface ReceiptSignature {
  signer_kind: ReceiptSignerKind;
  key_id: string;
  algorithm: 'ed25519';
  signature: string;
}

/** The outcome of the worker's verification of the device manifest signature. */
export interface ReceiptDeviceSignatureStatus {
  key_id: string;
  algorithm: 'ed25519';
  verified: boolean;
}

export interface ReceiptLeafCounts {
  file: number;
  shingle: number;
  component: number;
}

/** The full V1 attestation receipt. */
export interface AttestationReceipt {
  receipt_version: string;
  receipt_type: 'attestation';
  /** Stable, unique id for this receipt package — the PDF + verification URL key off it. */
  package_id: string;
  tenant_id: string;
  project_id: string;
  attestation_id: string;
  attestation_label: string;
  confirmed_attempt_id: string;
  manifest_object_key: string;
  /** SHA-256 of the manifest's RFC 8785 canonical bytes (the §8.1 signing digest), hex. */
  manifest_canonical_sha256: string;
  merkle_root: string;
  leaf_counts: ReceiptLeafCounts;
  /**
   * Sorted, deduplicated source_extraction_method values present across the
   * shingle leaves (ocr-v1.md §8). Empty array means whole-file only.
   */
  extraction_methods: string[];
  /**
   * Sorted, deduplicated component_method values present across component
   * leaves. Empty array means no component proof coverage.
   */
  component_methods: string[];
  hash_algorithm: string;
  protocol_version: string;
  device_signature: ReceiptDeviceSignatureStatus;
  confirmed_at: string;
  issued_at: string;
  /** Optional external signatures. Proveria is not an attestor in the product flow. */
  signatures: ReceiptSignature[];
}

export const RECEIPT_V1_VERSION = '1.0';
export const RECEIPT_PACKAGE_VERSION = '0.0.0';
