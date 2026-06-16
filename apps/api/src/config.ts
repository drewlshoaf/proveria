// Centralized env-driven config for the api service.
// Defaults are dev-safe; pilot/prod must override SESSION_SECRET and DATABASE_URL.

const required = (name: string, fallback: string | undefined): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number (got ${raw})`);
  }
  return parsed;
};

const port = num('API_PORT', 3001);

const splitCsv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const entraTenant = process.env.PROVERIA_OIDC_ENTRA_TENANT_ID ?? 'common';
const entraBaseUrl = `https://login.microsoftonline.com/${entraTenant}`;
const entraIssuer = `${entraBaseUrl}/v2.0`;
const entraClientId = process.env.PROVERIA_OIDC_ENTRA_CLIENT_ID ?? '';
const googleClientId = process.env.PROVERIA_OIDC_GOOGLE_CLIENT_ID ?? '';
const configuredOidcProviders = [
  ...(process.env.PROVERIA_OIDC_ENTRA_ENABLED === 'true' && entraClientId
    ? [
        {
          slug: 'entra',
          displayName:
            process.env.PROVERIA_OIDC_ENTRA_DISPLAY_NAME ??
            'Microsoft Entra ID',
          issuerUrl: entraIssuer,
          authorizationEndpoint: `${entraBaseUrl}/oauth2/v2.0/authorize`,
          tokenEndpoint: `${entraBaseUrl}/oauth2/v2.0/token`,
          jwksUri: `${entraBaseUrl}/discovery/v2.0/keys`,
          clientId: entraClientId,
          clientSecretRef:
            process.env.PROVERIA_OIDC_ENTRA_CLIENT_SECRET_REF ?? null,
          clientSecret: process.env.PROVERIA_OIDC_ENTRA_CLIENT_SECRET ?? null,
          scopes: splitCsv(process.env.PROVERIA_OIDC_ENTRA_SCOPES).length
            ? splitCsv(process.env.PROVERIA_OIDC_ENTRA_SCOPES)
            : ['openid', 'email', 'profile'],
          claimMapping: {
            subject: 'sub',
            email: 'email',
            emailVerified: 'email_verified',
            displayName: 'name',
          },
          allowedDomains: splitCsv(
            process.env.PROVERIA_OIDC_ENTRA_ALLOWED_DOMAINS,
          ),
        },
      ]
    : []),
  ...(process.env.PROVERIA_OIDC_GOOGLE_ENABLED === 'true' && googleClientId
    ? [
        {
          slug: 'google',
          displayName:
            process.env.PROVERIA_OIDC_GOOGLE_DISPLAY_NAME ?? 'Google',
          issuerUrl: 'https://accounts.google.com',
          authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
          clientId: googleClientId,
          clientSecretRef:
            process.env.PROVERIA_OIDC_GOOGLE_CLIENT_SECRET_REF ?? null,
          clientSecret: process.env.PROVERIA_OIDC_GOOGLE_CLIENT_SECRET ?? null,
          scopes: splitCsv(process.env.PROVERIA_OIDC_GOOGLE_SCOPES).length
            ? splitCsv(process.env.PROVERIA_OIDC_GOOGLE_SCOPES)
            : ['openid', 'email', 'profile'],
          claimMapping: {
            subject: 'sub',
            email: 'email',
            emailVerified: 'email_verified',
            displayName: 'name',
          },
          allowedDomains: splitCsv(
            process.env.PROVERIA_OIDC_GOOGLE_ALLOWED_DOMAINS,
          ),
        },
      ]
    : []),
];

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.API_HOST ?? '0.0.0.0',
  port,
  publicApiBaseUrl:
    process.env.PUBLIC_API_BASE_URL ?? `http://127.0.0.1:${port}`,
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: required(
    'DATABASE_URL',
    'postgres://proveria:proveria_dev@localhost:5432/proveria',
  ),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  s3Endpoint: process.env.S3_ENDPOINT || undefined,

  // 32-byte hex string for HMAC cookie signing. Dev default is fine locally;
  // a real value must be injected in pilot/prod.
  sessionSecret: required(
    'SESSION_SECRET',
    'proveria-dev-session-secret-do-not-use-in-prod',
  ),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'proveria_session',
  sessionLifetimeDays: num('SESSION_LIFETIME_DAYS', 7),

  // Proveria platform signing *public* key — the api verifies receipt
  // signatures against this on read. Must be the public half of the worker's
  // PROVERIA_SIGNING_PRIVATE_KEY; the dev default below pairs with the
  // worker's dev-default key.
  proveriaSigningPublicKey: required(
    'PROVERIA_SIGNING_PUBLIC_KEY',
    'yTqV98Lh2ppAXQlcqVwXg7508MccQ757iIYrb67fUVY',
  ),

  // Proveria platform signing *private* key — used inline by the lookup
  // endpoint (M7) to sign Team/Enterprise result packages. Dev default is a
  // throwaway keypair; pilot/prod MUST inject a real key.
  proveriaSigningKeyId:
    process.env.PROVERIA_SIGNING_KEY_ID ?? 'proveria-dev-platform-key',
  proveriaSigningPrivateKey: required(
    'PROVERIA_SIGNING_PRIVATE_KEY',
    'MC4CAQAwBQYDK2VwBCIEIJTQIRy9pxIpswsyB6XJtmvEBnONjtDyaUeZurNxgISf',
  ),

  // Token TTLs (minutes).
  emailVerificationTtlMinutes: num('EMAIL_VERIFICATION_TTL_MINUTES', 60 * 24),
  passwordResetTtlMinutes: num('PASSWORD_RESET_TTL_MINUTES', 30),

  // Platform-admin email allowlist (M15/C56). Comma-separated. Only these
  // signed-in users may hit /admin/* — V1 has no platform-admin role
  // concept yet; this env-var allowlist is the pragmatic gate.
  platformAdminEmails: (process.env.PROVERIA_PLATFORM_ADMINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  oidc: {
    stateTtlMinutes: num('PROVERIA_OIDC_STATE_TTL_MINUTES', 10),
    providers: configuredOidcProviders,
  },
} as const;

export type Config = typeof config;

// Reads process.env at call time so tests / hot-reload tools can flip
// behavior without re-importing the config module.
export const isProduction = (): boolean =>
  (process.env.NODE_ENV ?? config.nodeEnv) === 'production';

// Production safety: refuse to start with the dev-default signing key.
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.PROVERIA_SIGNING_PRIVATE_KEY
) {
  throw new Error(
    'PROVERIA_SIGNING_PRIVATE_KEY must be set in production — refusing to ' +
      'sign result packages with the dev default key',
  );
}
