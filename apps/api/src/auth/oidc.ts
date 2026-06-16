import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { eq } from 'drizzle-orm';

import {
  oidcIdentityProviders,
  type DrizzleClient,
  type OidcIdentityProvider,
} from '@proveria/db';

import { config } from '../config.js';

export interface PublicOidcProvider {
  slug: string;
  displayName: string;
  issuerUrl: string;
  scopes: string[];
}

export interface OidcClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  preferred_username?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  [key: string]: unknown;
}

interface Jwk extends JsonWebKey {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface Jwks {
  keys: Jwk[];
}

export const randomBase64Url = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const sha256Base64Url = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

export const oidcRedirectUri = (providerSlug: string): string =>
  `${config.publicApiBaseUrl.replace(/\/+$/, '')}/auth/oidc/${providerSlug}/callback`;

export const publicOidcProvider = (
  provider: OidcIdentityProvider,
): PublicOidcProvider => ({
  slug: provider.slug,
  displayName: provider.displayName,
  issuerUrl: provider.issuerUrl,
  scopes: provider.scopes,
});

export const buildAuthorizationUrl = (input: {
  provider: OidcIdentityProvider;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string => {
  const url = new URL(input.provider.authorizationEndpoint);
  url.searchParams.set('client_id', input.provider.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', oidcRedirectUri(input.provider.slug));
  url.searchParams.set('scope', input.provider.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
};

export const oidcClientSecret = (providerSlug: string): string | null => {
  const provider = config.oidc.providers.find((p) => p.slug === providerSlug);
  return provider?.clientSecret ?? null;
};

export const exchangeOidcCode = async (input: {
  provider: OidcIdentityProvider;
  code: string;
  codeVerifier: string;
}): Promise<{ idToken: string }> => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.provider.clientId,
    code: input.code,
    redirect_uri: oidcRedirectUri(input.provider.slug),
    code_verifier: input.codeVerifier,
  });
  const secret = oidcClientSecret(input.provider.slug);
  if (secret) body.set('client_secret', secret);

  const response = await fetch(input.provider.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    id_token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof payload.id_token !== 'string') {
    throw new Error(
      `oidc_token_exchange_failed:${String(payload.error ?? response.status)}`,
    );
  }
  return { idToken: payload.id_token };
};

const parseJwtPart = <T>(value: string): T => {
  const json = Buffer.from(value, 'base64url').toString('utf8');
  return JSON.parse(json) as T;
};

const audienceMatches = (audience: string | string[], clientId: string): boolean =>
  Array.isArray(audience)
    ? audience.includes(clientId)
    : audience === clientId;

export const verifyOidcIdToken = async (input: {
  provider: OidcIdentityProvider;
  idToken: string;
  nonceHash: string;
  now?: Date;
}): Promise<OidcClaims> => {
  const parts = input.idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('oidc_invalid_id_token');
  }

  const header = parseJwtPart<{ alg?: string; kid?: string }>(parts[0]);
  if (header.alg !== 'RS256') {
    throw new Error('oidc_unsupported_id_token_alg');
  }

  const jwksResponse = await fetch(input.provider.jwksUri, {
    headers: { accept: 'application/json' },
  });
  if (!jwksResponse.ok) {
    throw new Error(`oidc_jwks_fetch_failed:${jwksResponse.status}`);
  }
  const jwks = (await jwksResponse.json()) as Jwks;
  const jwk = jwks.keys.find(
    (key) => key.kid === header.kid && key.kty === 'RSA',
  );
  if (!jwk) {
    throw new Error('oidc_jwk_not_found');
  }

  const signatureOk = verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signatureOk) {
    throw new Error('oidc_invalid_id_token_signature');
  }

  const claims = parseJwtPart<OidcClaims>(parts[1]);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (claims.iss !== input.provider.issuerUrl) {
    throw new Error('oidc_invalid_issuer');
  }
  if (!audienceMatches(claims.aud, input.provider.clientId)) {
    throw new Error('oidc_invalid_audience');
  }
  if (claims.exp <= nowSeconds) {
    throw new Error('oidc_id_token_expired');
  }
  if (!claims.sub) {
    throw new Error('oidc_missing_subject');
  }
  if (!claims.nonce || sha256Hex(claims.nonce) !== input.nonceHash) {
    throw new Error('oidc_invalid_nonce');
  }
  return claims;
};

export const syncConfiguredOidcProviders = async (
  db: DrizzleClient,
): Promise<void> => {
  for (const provider of config.oidc.providers) {
    await db
      .insert(oidcIdentityProviders)
      .values({
        ...provider,
        enabled: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: oidcIdentityProviders.slug,
        set: {
          displayName: provider.displayName,
          issuerUrl: provider.issuerUrl,
          authorizationEndpoint: provider.authorizationEndpoint,
          tokenEndpoint: provider.tokenEndpoint,
          jwksUri: provider.jwksUri,
          clientId: provider.clientId,
          clientSecretRef: provider.clientSecretRef,
          scopes: provider.scopes,
          claimMapping: provider.claimMapping,
          allowedDomains: provider.allowedDomains,
          enabled: true,
          updatedAt: new Date(),
        },
      });
  }
};

export const findEnabledOidcProvider = async (
  db: DrizzleClient,
  slug: string,
): Promise<OidcIdentityProvider | null> => {
  const rows = await db
    .select()
    .from(oidcIdentityProviders)
    .where(eq(oidcIdentityProviders.slug, slug))
    .limit(1);
  const provider = rows[0];
  if (!provider || !provider.enabled) return null;
  return provider;
};
