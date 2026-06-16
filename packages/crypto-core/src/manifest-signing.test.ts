import { describe, it, expect } from 'vitest';
import { buildSigningDigest } from './manifest-signing.js';
import { hex, loadVectorFile } from './test-vectors.js';

interface ManifestSigningVectorFile {
  vectors: Array<{
    name: string;
    input: { manifest: Record<string, unknown> };
    expected: {
      canonicalManifestUtf8Hex: string;
      signingDigestHex: string;
    };
  }>;
}

const file = loadVectorFile<ManifestSigningVectorFile>('manifest-signing');

describe('manifest-signing — spec vectors', () => {
  for (const v of file.vectors) {
    it(v.name, () => {
      const { canonicalBytes, digest } = buildSigningDigest(
        v.input.manifest,
      );
      expect(hex(canonicalBytes)).toBe(
        v.expected.canonicalManifestUtf8Hex,
      );
      expect(hex(digest)).toBe(v.expected.signingDigestHex);
    });
  }
});

describe('manifest-signing — behavior', () => {
  it('strips any existing signatures before canonicalizing', () => {
    const withSig = buildSigningDigest({
      schema_version: '1.0',
      signatures: [{ signer_kind: 'device', signature: 'AAAA' }],
    });
    const withoutSig = buildSigningDigest({
      schema_version: '1.0',
      signatures: [],
    });
    expect(hex(withSig.digest)).toBe(hex(withoutSig.digest));
  });

  it('does not mutate the input manifest', () => {
    const manifest = {
      schema_version: '1.0',
      signatures: [{ signer_kind: 'device' }],
    };
    buildSigningDigest(manifest);
    expect(manifest.signatures).toHaveLength(1);
  });

  it('the canonical bytes always include "signatures":[]', () => {
    const { canonicalBytes } = buildSigningDigest({ a: 1 });
    expect(Buffer.from(canonicalBytes).toString('utf8')).toContain(
      '"signatures":[]',
    );
  });
});
