import { describe, it, expect } from 'vitest';
import { CRYPTO_CORE_PACKAGE_VERSION } from './index.js';

describe('@proveria/crypto-core', () => {
  it('exports a semver version string', () => {
    expect(CRYPTO_CORE_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
