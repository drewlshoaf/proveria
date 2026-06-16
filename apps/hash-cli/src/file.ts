// `proveria-hash file <path>` — whole-file SHA-256.
//
// Output matches what the desktop's submit flow puts in file/sha256/v1
// leaves: canonical_payload_hash is the raw SHA-256, leaf_hash is the
// Merkle leaf hash derived via crypto-core. The verifier lookup form
// accepts the former; the latter is exposed for consumers building proofs
// by hand.

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

import { computeLeafHash, LEAF_TYPES } from '@proveria/crypto-core';

import type { FileHashRecord } from './output.js';

/** Stream-hash a file so we don't blow up on large inputs. */
const sha256File = async (path: string): Promise<Buffer> => {
  const hasher = createHash('sha256');
  const stream = createReadStream(path);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      hasher.update(chunk);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hasher.digest();
};

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export const hashFile = async (path: string): Promise<FileHashRecord> => {
  const st = await stat(path);
  if (!st.isFile()) {
    throw new Error(`not a regular file: ${path}`);
  }
  const sha = await sha256File(path);
  const canonical_payload_hash = toHex(sha);
  const leafHash = computeLeafHash({
    protocolVersion: '1.0',
    leafType: LEAF_TYPES.fileSha256V1,
    hashAlgorithm: 'sha256',
    canonicalPayloadHash: new Uint8Array(sha),
  });
  return {
    kind: 'file',
    path,
    byte_size: st.size,
    hash_algorithm: 'sha256',
    protocol_version: '1.0',
    leaf_type: 'file/sha256/v1',
    canonical_payload_hash,
    leaf_hash: toHex(leafHash),
  };
};

export { basename };
