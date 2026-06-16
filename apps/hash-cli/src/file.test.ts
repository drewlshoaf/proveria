import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeLeafHash, LEAF_TYPES } from '@proveria/crypto-core';
import { describe, expect, it } from 'vitest';

import { hashFile } from './file.js';

const writeTmpFile = async (
  contents: string | Buffer,
): Promise<string> => {
  const path = join(tmpdir(), `hash-cli-${randomUUID()}.bin`);
  await writeFile(path, contents);
  return path;
};

describe('hashFile', () => {
  it('returns the raw SHA-256 of the file as canonical_payload_hash', async () => {
    const content = 'Proveria CLI test corpus\n';
    const path = await writeTmpFile(content);
    const expected = createHash('sha256').update(content).digest('hex');
    const r = await hashFile(path);
    expect(r.canonical_payload_hash).toBe(expected);
    expect(r.path).toBe(path);
    expect(r.byte_size).toBe(Buffer.byteLength(content));
    expect(r.leaf_type).toBe('file/sha256/v1');
    expect(r.hash_algorithm).toBe('sha256');
    expect(r.protocol_version).toBe('1.0');
  });

  it('leaf_hash matches computeLeafHash(canonical_payload_hash)', async () => {
    const path = await writeTmpFile(Buffer.from([1, 2, 3, 4, 5]));
    const r = await hashFile(path);
    const direct = computeLeafHash({
      protocolVersion: '1.0',
      leafType: LEAF_TYPES.fileSha256V1,
      hashAlgorithm: 'sha256',
      canonicalPayloadHash: new Uint8Array(
        Buffer.from(r.canonical_payload_hash, 'hex'),
      ),
    });
    expect(r.leaf_hash).toBe(Buffer.from(direct).toString('hex'));
  });

  it('streaming the file produces the same digest a one-shot would', async () => {
    // ~3 MB buffer of pseudo-random bytes — well past Node's default 64 KB
    // stream chunk so the hashFile loop iterates many times.
    const big = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 31) & 0xff;
    const path = await writeTmpFile(big);
    const expected = createHash('sha256').update(big).digest('hex');
    const r = await hashFile(path);
    expect(r.canonical_payload_hash).toBe(expected);
    expect(r.byte_size).toBe(big.length);
  });

  it('throws cleanly for a non-file path', async () => {
    await expect(hashFile(tmpdir())).rejects.toThrow(/not a regular file/);
  });
});
