// Shared output helpers for the hash CLI.
//
// Two emission modes:
//   - plain   one-line shasum-shaped output: "<hex>  <path>"
//   - json    a structured record on stdout (one JSON object per invocation)
//
// Algorithm + version metadata is always included in JSON output so a
// verifier pasting CLI output into the web client can reason about what the
// hash represents without re-reading the spec.

export interface FileHashRecord {
  kind: 'file';
  path: string;
  byte_size: number;
  hash_algorithm: 'sha256';
  protocol_version: '1.0';
  leaf_type: 'file/sha256/v1';
  /** Raw SHA-256 of the file — the value the verifier lookup form accepts. */
  canonical_payload_hash: string;
  /** The Merkle leaf hash derived per Protocol V1 §4.1. */
  leaf_hash: string;
}

export interface ShingleHashRecord {
  kind: 'shingle';
  source_path: string;
  source_extraction_method: string;
  preset: 'standard' | 'broad' | 'sensitive';
  shingling_version: '1.0';
  normalization_version: '1.0';
  tokenizer_version: '1.0';
  hash_algorithm: 'sha256';
  protocol_version: '1.0';
  leaf_type: 'shingle/sha256/v1';
  /** Plaintext-safe counts; same shape the desktop reports. */
  paragraph_count: number;
  token_count: number;
  shingle_count: number;
  shingles: Array<{
    source_index: number;
    /** SHA-256 of the canonical shingle payload. */
    canonical_payload_hash: string;
    /** Merkle leaf hash. */
    leaf_hash: string;
  }>;
}

export interface VerifyRecord {
  kind: 'verify';
  package_id: string;
  result_type: 'match' | 'no_match';
  proof_ok: boolean;
  signature_required: boolean;
  signature_verified: boolean | null;
  /** Non-null on no_match. Math-only verification mirror of §9.3. */
  no_match_statement_ok?: boolean;
  notes: string[];
}

export type AnyRecord = FileHashRecord | ShingleHashRecord | VerifyRecord;

export const writeJson = (record: AnyRecord): void => {
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
};

export const writeFileHashPlain = (r: FileHashRecord): void => {
  process.stdout.write(`${r.canonical_payload_hash}  ${r.path}\n`);
};

export const writeShinglePlain = (r: ShingleHashRecord): void => {
  // Mirror the file plain shape per shingle so output is grep/awk-friendly:
  //   <hex>  <path>#<source_index>
  for (const s of r.shingles) {
    process.stdout.write(
      `${s.canonical_payload_hash}  ${r.source_path}#${s.source_index}\n`,
    );
  }
};

export const writeVerifyPlain = (r: VerifyRecord): void => {
  const ok = r.proof_ok && (!r.signature_required || r.signature_verified);
  process.stdout.write(`${ok ? 'OK' : 'FAIL'}  ${r.package_id}\n`);
  for (const n of r.notes) process.stdout.write(`  · ${n}\n`);
};
