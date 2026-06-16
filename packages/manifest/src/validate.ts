// Manifest validation. Two layers:
//
//   validateManifest(value)        — structural + cryptographic-recompute
//                                    checks. Confirms every leaf_hash is
//                                    genuinely derived from its payload hash
//                                    and that merkle_root recomputes from the
//                                    leaf set. No key material required.
//
//   verifyManifestSignature(...)   — given an already-resolved public key,
//                                    confirms a signature over the §8.1
//                                    signing digest.
//
// The worker (M4/C14) calls validateManifest, then resolves the device's
// stored public key and calls verifyManifestSignature. This module stays
// pure — no DB, no I/O.

import {
  buildSigningDigest,
  computeLeafHash,
  computeMerkleRoot,
  isLeafType,
  verifyEd25519,
} from '@proveria/crypto-core';

import {
  MANIFEST_V1_VERSIONS,
  type Manifest,
  type SignatureEntry,
  type SignerKind,
} from './types.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const HEX64 = /^[0-9a-f]{64}$/;
// ISO 8601 UTC timestamp, per Protocol V1 §2 rule 1. Date.parse alone is too
// permissive (accepts "2026-05-13", "May 13 2026", etc.).
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

const isSignerKind = (v: unknown): v is SignerKind =>
  v === 'device' || v === 'proveria' || v === 'customer';

const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof Manifest> = [
  'schema_version',
  'protocol_version',
  'canonicalization_version',
  'merkle_version',
  'hash_algorithm',
  'hash_algorithm_version',
  'tenant_id',
  'project_id',
  'attestation_id',
  'attempt_id',
  'created_by_user_id',
  'created_by_device_id',
  'created_by_profile_id',
  'merkle_root',
  'created_at',
];

/**
 * Structural + cryptographic-recompute validation. Returns every issue found
 * rather than failing on the first — the worker logs all of them.
 */
export const validateManifest = (value: unknown): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string): void => {
    issues.push({ field, message });
  };

  if (!isPlainObject(value)) {
    return { valid: false, issues: [{ field: '(root)', message: 'not an object' }] };
  }
  const m = value as Partial<Manifest>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(m[field])) {
      add(field, 'missing or not a non-empty string');
    }
  }

  // Version fields must be exactly the V1 values — unknown versions fail loud.
  for (const [field, expected] of Object.entries(MANIFEST_V1_VERSIONS)) {
    const actual = (m as Record<string, unknown>)[field];
    if (actual !== expected) {
      add(field, `expected "${expected}", got ${JSON.stringify(actual)}`);
    }
  }

  // created_at must be an ISO 8601 timestamp (§2 rule 1).
  if (
    isNonEmptyString(m.created_at) &&
    (!ISO_8601.test(m.created_at) || Number.isNaN(Date.parse(m.created_at)))
  ) {
    add('created_at', 'not an ISO 8601 timestamp');
  }

  // source_summary must carry the required integer counts.
  if (!isPlainObject(m.source_summary)) {
    add('source_summary', 'missing or not an object');
  } else {
    for (const key of ['file_count', 'shingle_count', 'ocr_page_count']) {
      const v = m.source_summary[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        add(`source_summary.${key}`, 'missing or not a non-negative integer');
      }
    }
  }

  for (const objField of ['policy_context', 'extraction_metadata'] as const) {
    if (!isPlainObject(m[objField])) {
      add(objField, 'missing or not an object');
    }
  }

  // leaf_set: non-empty, each entry well-formed, leaf_hash recomputes.
  if (!Array.isArray(m.leaf_set) || m.leaf_set.length === 0) {
    add('leaf_set', 'missing or empty');
    return { valid: issues.length === 0, issues };
  }

  const seenLeafHashes = new Set<string>();
  let sortedOk = true;
  let prevHash = '';
  m.leaf_set.forEach((leaf, i) => {
    const path = `leaf_set[${i}]`;
    if (!isPlainObject(leaf)) {
      add(path, 'not an object');
      return;
    }
    const leafType = leaf.leaf_type;
    const leafHash = leaf.leaf_hash;
    const payloadHash = leaf.canonical_payload_hash;

    if (typeof leafType !== 'string' || !isLeafType(leafType)) {
      add(`${path}.leaf_type`, `unknown leaf_type: ${String(leafType)}`);
    }
    if (typeof payloadHash !== 'string' || !HEX64.test(payloadHash)) {
      add(`${path}.canonical_payload_hash`, 'not 64-char lowercase hex');
    }
    if (typeof leafHash !== 'string' || !HEX64.test(leafHash)) {
      add(`${path}.leaf_hash`, 'not 64-char lowercase hex');
      return;
    }

    // Recompute leaf_hash from its declared inputs — the trust-spine check.
    if (
      typeof leafType === 'string' &&
      isLeafType(leafType) &&
      typeof payloadHash === 'string' &&
      HEX64.test(payloadHash)
    ) {
      const recomputed = toHex(
        computeLeafHash({
          protocolVersion: MANIFEST_V1_VERSIONS.protocol_version,
          leafType,
          hashAlgorithm: MANIFEST_V1_VERSIONS.hash_algorithm,
          canonicalPayloadHash: fromHex(payloadHash),
        }),
      );
      if (recomputed !== leafHash) {
        add(
          `${path}.leaf_hash`,
          `does not match recomputed value (declared ${leafHash}, recomputed ${recomputed})`,
        );
      }
    }

    if (seenLeafHashes.has(leafHash)) {
      add(`${path}.leaf_hash`, 'duplicate leaf_hash');
    }
    seenLeafHashes.add(leafHash);

    if (prevHash !== '' && leafHash < prevHash) sortedOk = false;
    prevHash = leafHash;
  });

  if (!sortedOk) {
    add('leaf_set', 'not sorted by leaf_hash (§6.2)');
  }

  // leaf_counts must match the actual tally.
  if (!isPlainObject(m.leaf_counts)) {
    add('leaf_counts', 'missing or not an object');
  } else {
    const tally = { file: 0, shingle: 0, component: 0 };
    for (const leaf of m.leaf_set) {
      if (isPlainObject(leaf) && typeof leaf.leaf_type === 'string') {
        if (leaf.leaf_type === 'file/sha256/v1') tally.file += 1;
        else if (leaf.leaf_type === 'shingle/sha256/v1') tally.shingle += 1;
        else if (leaf.leaf_type === 'component/sha256/v1')
          tally.component += 1;
      }
    }
    for (const key of ['file', 'shingle', 'component'] as const) {
      if (m.leaf_counts[key] !== tally[key]) {
        add(
          `leaf_counts.${key}`,
          `declared ${String(m.leaf_counts[key])}, actual ${tally[key]}`,
        );
      }
    }
  }

  // merkle_root must recompute from the leaf set.
  if (isNonEmptyString(m.merkle_root) && HEX64.test(m.merkle_root)) {
    const allHexValid = m.leaf_set.every(
      (l) =>
        isPlainObject(l) &&
        typeof l.leaf_hash === 'string' &&
        HEX64.test(l.leaf_hash),
    );
    if (allHexValid) {
      try {
        const recomputed = toHex(
          computeMerkleRoot(
            m.leaf_set.map((l) =>
              fromHex((l as { leaf_hash: string }).leaf_hash),
            ),
          ),
        );
        if (recomputed !== m.merkle_root) {
          add(
            'merkle_root',
            `does not match recomputed root (declared ${m.merkle_root}, recomputed ${recomputed})`,
          );
        }
      } catch (err) {
        add('merkle_root', `recompute failed: ${(err as Error).message}`);
      }
    }
  } else if (m.merkle_root !== undefined) {
    add('merkle_root', 'not 64-char lowercase hex');
  }

  // signatures: contents are cryptographically verified separately, but the
  // manifest must still carry well-formed signature entries.
  if (!Array.isArray(m.signatures)) {
    add('signatures', 'missing or not an array');
  } else {
    m.signatures.forEach((sig, i) => {
      const path = `signatures[${i}]`;
      if (!isPlainObject(sig)) {
        add(path, 'not an object');
        return;
      }
      if (!isSignerKind(sig.signer_kind)) {
        add(
          `${path}.signer_kind`,
          `unknown signer_kind: ${String(sig.signer_kind)}`,
        );
      }
      if (!isNonEmptyString(sig.key_id)) {
        add(`${path}.key_id`, 'missing or not a non-empty string');
      }
      if (sig.algorithm !== 'ed25519') {
        add(`${path}.algorithm`, 'expected "ed25519"');
      }
      if (!isNonEmptyString(sig.signature)) {
        add(`${path}.signature`, 'missing or not a non-empty string');
      }
    });
  }

  return { valid: issues.length === 0, issues };
};

/**
 * Verify the signature of `signerKind` over the manifest's §8.1 signing
 * digest, using an already-resolved public key. Returns false when there is
 * no matching signature entry or the signature does not verify.
 */
export const verifyManifestSignature = async (
  manifest: Manifest,
  signerKind: SignerKind,
  publicKeyBase64Url: string,
  expectedKeyId?: string,
): Promise<boolean> => {
  const entry: SignatureEntry | undefined = manifest.signatures.find(
    (s) => s.signer_kind === signerKind,
  );
  if (!entry || entry.algorithm !== 'ed25519') return false;
  if (expectedKeyId !== undefined && entry.key_id !== expectedKeyId) {
    return false;
  }
  const { digest } = buildSigningDigest(
    manifest as unknown as Record<string, unknown>,
  );
  return verifyEd25519(digest, entry.signature, publicKeyBase64Url);
};
