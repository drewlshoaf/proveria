// Protocol V1 §4 — Merkle leaf encoding.
//
// Binary leaf_hash_input layout:
//
//   0x00                                                 1  byte (domain separator)
//   uint32be(len(protocolVersion)) || protocolVersion    4 + N bytes
//   uint32be(len(leafType))         || leafType          4 + N bytes
//   uint32be(len(hashAlgorithm))    || hashAlgorithm     4 + N bytes
//   uint32be(len(canonicalPayloadHash)) || hashBytes     4 + 32 bytes
//
// leaf_hash = SHA-256(leaf_hash_input)
//
// Length prefixes are 4-byte big-endian unsigned ints (uint32 BE).
// canonicalPayloadHash MUST be raw 32 bytes (not hex).

import { createHash } from 'node:crypto';

const TEXT_ENCODER = new TextEncoder();

/** V1 leaf type registry per Protocol V1 §5. */
export const LEAF_TYPES = {
  fileSha256V1: 'file/sha256/v1',
  shingleSha256V1: 'shingle/sha256/v1',
  componentSha256V1: 'component/sha256/v1',
} as const;

export type LeafType = (typeof LEAF_TYPES)[keyof typeof LEAF_TYPES];

export const LEAF_TYPE_VALUES: readonly LeafType[] =
  Object.values(LEAF_TYPES);

export const isLeafType = (s: string): s is LeafType =>
  (LEAF_TYPE_VALUES as readonly string[]).includes(s);

export interface LeafInput {
  /** Protocol version string (e.g. "1.0"). */
  protocolVersion: string;
  /** One of LEAF_TYPES. */
  leafType: LeafType;
  /** Hash algorithm identifier (e.g. "sha256"). */
  hashAlgorithm: string;
  /** Raw 32-byte SHA-256 digest of the canonical payload. */
  canonicalPayloadHash: Uint8Array;
}

const lengthPrefix = (length: number): Uint8Array => {
  if (length < 0 || length > 0xffffffff) {
    throw new Error(`length out of uint32 range: ${length}`);
  }
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, length, false /* big-endian */);
  return buf;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** Build the binary `leaf_hash_input` bytes per §4.1. */
export const buildLeafHashInput = (input: LeafInput): Uint8Array => {
  if (input.canonicalPayloadHash.length !== 32) {
    throw new Error(
      `canonical_payload_hash must be 32 bytes (got ${input.canonicalPayloadHash.length})`,
    );
  }
  if (!isLeafType(input.leafType)) {
    throw new Error(`unknown leaf_type: ${input.leafType}`);
  }
  const protocol = TEXT_ENCODER.encode(input.protocolVersion);
  const leafType = TEXT_ENCODER.encode(input.leafType);
  const algo = TEXT_ENCODER.encode(input.hashAlgorithm);
  return concat([
    new Uint8Array([0x00]),
    lengthPrefix(protocol.length),
    protocol,
    lengthPrefix(leafType.length),
    leafType,
    lengthPrefix(algo.length),
    algo,
    lengthPrefix(input.canonicalPayloadHash.length),
    input.canonicalPayloadHash,
  ]);
};

/** Compute `leaf_hash = SHA-256(leaf_hash_input)`. */
export const computeLeafHash = (input: LeafInput): Uint8Array => {
  return new Uint8Array(
    createHash('sha256').update(buildLeafHashInput(input)).digest(),
  );
};
