import { afterEach, describe, expect, it, vi } from 'vitest';

const loadConfig = async () => {
  vi.resetModules();
  return (await import('./config.js')).config;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config oidc providers', () => {
  it('does not configure OIDC providers by default', async () => {
    const config = await loadConfig();

    expect(config.oidc.providers).toEqual([]);
  });

  it('configures Google when the Google provider is enabled', async () => {
    vi.stubEnv('PROVERIA_OIDC_GOOGLE_ENABLED', 'true');
    vi.stubEnv('PROVERIA_OIDC_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubEnv('PROVERIA_OIDC_GOOGLE_CLIENT_SECRET_REF', 'google-secret-ref');
    vi.stubEnv('PROVERIA_OIDC_GOOGLE_ALLOWED_DOMAINS', 'example.com');

    const config = await loadConfig();

    expect(config.oidc.providers).toEqual([
      expect.objectContaining({
        slug: 'google',
        displayName: 'Google',
        issuerUrl: 'https://accounts.google.com',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        clientId: 'google-client-id',
        clientSecretRef: 'google-secret-ref',
        scopes: ['openid', 'email', 'profile'],
        allowedDomains: ['example.com'],
      }),
    ]);
  });

  it('can configure Entra and Google together', async () => {
    vi.stubEnv('PROVERIA_OIDC_ENTRA_ENABLED', 'true');
    vi.stubEnv('PROVERIA_OIDC_ENTRA_CLIENT_ID', 'entra-client-id');
    vi.stubEnv('PROVERIA_OIDC_GOOGLE_ENABLED', 'true');
    vi.stubEnv('PROVERIA_OIDC_GOOGLE_CLIENT_ID', 'google-client-id');

    const config = await loadConfig();

    expect(config.oidc.providers.map((provider) => provider.slug)).toEqual([
      'entra',
      'google',
    ]);
  });
});
