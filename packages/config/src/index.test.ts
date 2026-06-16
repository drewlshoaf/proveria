import { describe, it, expect } from 'vitest';
import { CONFIG_PACKAGE_VERSION } from './index.js';

describe('@proveria/config', () => {
  it('exports a semver version string', () => {
    expect(CONFIG_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
