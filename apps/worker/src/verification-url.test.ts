import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_VERIFICATION_BASE_URL,
  verificationBaseUrlFromEnv,
  verificationUrlForLink,
} from './verification-url.js';

describe('verification URLs', () => {
  const original = process.env.PROVERIA_VERIFICATION_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROVERIA_VERIFICATION_BASE_URL;
    } else {
      process.env.PROVERIA_VERIFICATION_BASE_URL = original;
    }
  });

  it('defaults generated verification links to the verifier web client', () => {
    delete process.env.PROVERIA_VERIFICATION_BASE_URL;

    expect(verificationBaseUrlFromEnv()).toBe(DEFAULT_VERIFICATION_BASE_URL);
    expect(verificationBaseUrlFromEnv()).toBe('http://127.0.0.1:3003');
  });

  it('normalizes trailing slashes when building link URLs', () => {
    expect(verificationUrlForLink('https://verify.example.com///', 'vrf_123')).toBe(
      'https://verify.example.com/v/vrf_123',
    );
  });
});
