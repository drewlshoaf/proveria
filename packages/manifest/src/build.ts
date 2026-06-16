// Manifest builder. Takes leaf descriptors + identity + context and assembles
// an unsigned manifest: computes each leaf_hash, sorts the leaf_set into
// canonical order (§6.2), recomputes the Merkle root, and tallies leaf_counts.
//
// The returned manifest has `signatures: []`. The caller signs it separately —
// see @proveria/crypto-core's buildSigningDigest (§8.1).

import {
  computeLeafHash,
  computeMerkleRoot,
  LEAF_TYPES,
  type LeafType,
} from '@proveria/crypto-core';

import {
  MANIFEST_V1_VERSIONS,
  type LeafCounts,
  type LeafEntry,
  type Manifest,
  type SourceSummary,
} from './types.js';

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

/** A single leaf the producer wants to include, before leaf_hash is computed. */
export interface LeafDescriptor {
  leafType: LeafType;
  /** Raw 32-byte SHA-256 of the canonical payload. */
  canonicalPayloadHash: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface BuildManifestInput {
  tenantId: string;
  projectId: string;
  attestationId: string;
  attemptId: string;
  createdByUserId: string;
  createdByDeviceId: string;
  createdByProfileId: string;
  templateId?: string | null;
  leaves: LeafDescriptor[];
  policyContext?: Record<string, unknown>;
  sourceSummary: SourceSummary;
  extractionMetadata?: Record<string, unknown>;
  shinglingVersion?: string | null;
  ocrExtractionVersion?: string | null;
  /** Defaults to the current time in ISO 8601 UTC. */
  createdAt?: string;
}

const tallyLeafCounts = (entries: LeafEntry[]): LeafCounts => {
  const counts: LeafCounts = { file: 0, shingle: 0, component: 0 };
  for (const e of entries) {
    if (e.leaf_type === LEAF_TYPES.fileSha256V1) counts.file += 1;
    else if (e.leaf_type === LEAF_TYPES.shingleSha256V1) counts.shingle += 1;
    else if (e.leaf_type === LEAF_TYPES.componentSha256V1)
      counts.component += 1;
  }
  return counts;
};

export const buildManifest = (input: BuildManifestInput): Manifest => {
  if (input.leaves.length === 0) {
    throw new Error('cannot build a manifest with zero leaves');
  }

  // Compute each leaf hash, then sort the entries by leaf_hash. Hex strings of
  // equal length sort identically to their raw bytes, so a plain string sort
  // matches the §6.2 lexicographic-by-raw-bytes rule.
  const leafEntries: LeafEntry[] = input.leaves.map((l) => {
    const leafHash = computeLeafHash({
      protocolVersion: MANIFEST_V1_VERSIONS.protocol_version,
      leafType: l.leafType,
      hashAlgorithm: MANIFEST_V1_VERSIONS.hash_algorithm,
      canonicalPayloadHash: l.canonicalPayloadHash,
    });
    return {
      leaf_type: l.leafType,
      leaf_hash: toHex(leafHash),
      canonical_payload_hash: toHex(l.canonicalPayloadHash),
      metadata: l.metadata ?? {},
    };
  });
  leafEntries.sort((a, b) =>
    a.leaf_hash < b.leaf_hash ? -1 : a.leaf_hash > b.leaf_hash ? 1 : 0,
  );

  // computeMerkleRoot re-sorts + rejects duplicates; building the root from
  // the same hash set keeps the manifest's merkle_root authoritative.
  const merkleRoot = computeMerkleRoot(
    leafEntries.map((e) => fromHex(e.leaf_hash)),
  );

  return {
    schema_version: MANIFEST_V1_VERSIONS.schema_version,
    protocol_version: MANIFEST_V1_VERSIONS.protocol_version,
    canonicalization_version: MANIFEST_V1_VERSIONS.canonicalization_version,
    merkle_version: MANIFEST_V1_VERSIONS.merkle_version,
    hash_algorithm: MANIFEST_V1_VERSIONS.hash_algorithm,
    hash_algorithm_version: MANIFEST_V1_VERSIONS.hash_algorithm_version,
    shingling_version: input.shinglingVersion ?? null,
    ocr_extraction_version: input.ocrExtractionVersion ?? null,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    attestation_id: input.attestationId,
    attempt_id: input.attemptId,
    created_by_user_id: input.createdByUserId,
    created_by_device_id: input.createdByDeviceId,
    created_by_profile_id: input.createdByProfileId,
    template_id: input.templateId ?? null,
    policy_context: input.policyContext ?? {},
    source_summary: input.sourceSummary,
    extraction_metadata: input.extractionMetadata ?? {},
    leaf_set: leafEntries,
    leaf_counts: tallyLeafCounts(leafEntries),
    merkle_root: toHex(merkleRoot),
    signatures: [],
    created_at: input.createdAt ?? new Date().toISOString(),
  };
};
