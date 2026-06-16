import { describe, it, expect } from 'vitest';
import { MANIFEST_PACKAGE_VERSION } from './index.js';

describe('@proveria/manifest', () => {
  it('exports a semver version string', () => {
    expect(MANIFEST_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
