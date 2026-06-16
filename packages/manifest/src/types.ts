// Manifest schema types per Protocol V1 §7. The manifest is the canonical
// JSON document a producer uploads alongside a leaf set; the server
// recomputes the Merkle root from it and verifies the device signature.

import type { LeafType } from '@proveria/crypto-core';

export type SignerKind = 'device' | 'proveria' | 'customer';

/** A single entry in the manifest's leaf_set (§7.2). Hashes are lowercase hex. */
export interface LeafEntry {
  leaf_type: LeafType;
  leaf_hash: string;
  canonical_payload_hash: string;
  metadata: Record<string, unknown>;
}

/** A signature entry (§8.2). signature is base64url-encoded raw Ed25519. */
export interface SignatureEntry {
  signer_kind: SignerKind;
  key_id: string;
  algorithm: 'ed25519';
  signature: string;
}

/** source_summary carries counts only — never plaintext (§7.1). */
export interface SourceSummary {
  file_count: number;
  shingle_count: number;
  ocr_page_count: number;
  [key: string]: unknown;
}

export interface LeafCounts {
  file: number;
  shingle: number;
  component: number;
}

/** The full V1 manifest (§7.1). */
export interface Manifest {
  schema_version: string;
  protocol_version: string;
  canonicalization_version: string;
  merkle_version: string;
  hash_algorithm: string;
  hash_algorithm_version: string;
  shingling_version: string | null;
  ocr_extraction_version: string | null;
  tenant_id: string;
  project_id: string;
  attestation_id: string;
  attempt_id: string;
  created_by_user_id: string;
  created_by_device_id: string;
  created_by_profile_id: string;
  template_id: string | null;
  policy_context: Record<string, unknown>;
  source_summary: SourceSummary;
  extraction_metadata: Record<string, unknown>;
  leaf_set: LeafEntry[];
  leaf_counts: LeafCounts;
  merkle_root: string;
  signatures: SignatureEntry[];
  created_at: string;
}

/** V1 fixed version field values. */
export const MANIFEST_V1_VERSIONS = {
  schema_version: '1.0',
  protocol_version: '1.0',
  canonicalization_version: '1.0',
  merkle_version: '1.0',
  hash_algorithm: 'sha256',
  hash_algorithm_version: '1.0',
} as const;

export const MANIFEST_PACKAGE_VERSION = '0.0.0';
