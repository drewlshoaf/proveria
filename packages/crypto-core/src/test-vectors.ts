// Loader for the Protocol V1 reference test vectors at
// docs/protocol/v1/test-vectors/. Tests in this package consume these so the
// implementation is checked against the spec's pinned bytes, not just itself.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const vectorsDir = resolve(
  here,
  '..',
  '..',
  '..',
  'docs',
  'protocol',
  'v1',
  'test-vectors',
);

export const loadVectorFile = <T>(name: string): T => {
  const raw = readFileSync(resolve(vectorsDir, `${name}.json`), 'utf8');
  return JSON.parse(raw) as T;
};

export const hex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('hex');

export const unhex = (h: string): Uint8Array =>
  new Uint8Array(Buffer.from(h, 'hex'));
