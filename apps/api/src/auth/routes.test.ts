// Integration tests for /auth/*.
//
// These tests hit a real Postgres. They expect:
//   - docker compose up (postgres healthy)
//   - drizzle migrations applied (pnpm --filter @proveria/db db:migrate)
//   - NODE_ENV != production (so LogNotificationProvider can be constructed)
//
// Tables are truncated before each test so order is independent.

import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createClient, type ClientHandle } from '@proveria/db';

import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { authPlugin } from './routes.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;
let notificationLines: string[];

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_events,
      public.oidc_auth_states,
      public.external_identities,
      public.oidc_identity_providers,
      public.tenant_invitations,
      public.password_reset_tokens,
      public.email_verification_tokens,
      public.device_pairing_attempts,
      public.devices,
      public.sessions,
      public.organization_memberships,
      public.tenant_memberships,
      public.tenants,
      public.organizations,
      public.users
    RESTART IDENTITY CASCADE
  `);
};

const extractToken = (line: string): string => {
  const match = /token=(\S+)/.exec(line);
  if (!match) {
    throw new Error(`could not find token in line: ${line}`);
  }
  return match[1] ?? '';
};

const cookieHeader = (response: { headers: { 'set-cookie'?: string | string[] } }): string => {
  const raw = response.headers['set-cookie'];
  if (!raw) throw new Error('expected Set-Cookie header on response');
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c))
    .join('; ');
};

const encodeJwtPart = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const signedRs256Jwt = (input: {
  kid: string;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  claims: Record<string, unknown>;
}): string => {
  const header = encodeJwtPart({
    alg: 'RS256',
    typ: 'JWT',
    kid: input.kid,
  });
  const payload = encodeJwtPart(input.claims);
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    input.privateKey,
  ).toString('base64url');
  return `${signingInput}.${signature}`;
};

beforeAll(async () => {
  dbHandle = createClient({ url: DATABASE_URL, max: 5 });
  app = Fastify({ logger: false });
  await app.register(cookie, { secret: config.sessionSecret });
  notificationLines = [];
  const notifications = new LogNotificationProvider((line) =>
    notificationLines.push(line),
  );
  await app.register(authPlugin, { db: dbHandle.db, notifications });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  notificationLines.length = 0;
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// oidc
// ---------------------------------------------------------------------------

describe('GET /auth/oidc/providers', () => {
  it('lists enabled providers without exposing secret references', async () => {
    await dbHandle.sql`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id,
          client_secret_ref,
          scopes,
          claim_mapping,
          allowed_domains
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id',
          'secret-ref',
          '["openid","email","profile"]'::jsonb,
          '{"subject":"sub","email":"email"}'::jsonb,
          '["example.com"]'::jsonb
        )`;

    const res = await app.inject({
      method: 'GET',
      url: '/auth/oidc/providers',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      providers: [
        {
          slug: 'entra',
          displayName: 'Microsoft Entra ID',
          issuerUrl: 'https://login.microsoftonline.com/common/v2.0',
          scopes: ['openid', 'email', 'profile'],
        },
      ],
    });
    expect(res.body).not.toContain('secret-ref');
  });
});

describe('GET /auth/oidc/:provider/start', () => {
  it('creates a short-lived state and returns an authorization URL', async () => {
    await dbHandle.sql`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )`;

    const res = await app.inject({
      method: 'GET',
      url: '/auth/oidc/entra/start?redirectTo=%2Fattestations',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      provider: { slug: string; displayName: string };
      authorizationUrl: string;
      expiresAt: string;
    };
    expect(body.provider).toMatchObject({
      slug: 'entra',
      displayName: 'Microsoft Entra ID',
    });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const url = new URL(body.authorizationUrl);
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3001/auth/oidc/entra/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);

    const stateRows = await dbHandle.sql<
      { redirect_to: string; consumed_at: Date | null }[]
    >`SELECT redirect_to, consumed_at FROM public.oidc_auth_states`;
    expect(stateRows).toHaveLength(1);
    expect(stateRows[0]!.redirect_to).toBe('/attestations');
    expect(stateRows[0]!.consumed_at).toBeNull();
  });

  it('returns 404 for an unknown or disabled provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/oidc/missing/start',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'oidc_provider_not_found' });
  });

  it('rejects non-local redirect targets', async () => {
    await dbHandle.sql`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )`;

    const res = await app.inject({
      method: 'GET',
      url: '/auth/oidc/entra/start?redirectTo=https%3A%2F%2Fevil.example',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_redirect_to' });
  });
});

describe('GET /auth/oidc/:provider/callback', () => {
  it('validates the id token, links an existing user, and creates a session', async () => {
    await dbHandle.sql`
      INSERT INTO public.users (email, password_hash, display_name)
      VALUES ('entra-user@example.com', 'hash-not-used', 'Entra User')`;
    const userRows = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'entra-user@example.com' LIMIT 1`;
    const tenantRows = await dbHandle.sql<{ id: string }[]>`
      WITH org AS (
        INSERT INTO public.organizations (name)
        VALUES ('Entra Workspace')
        RETURNING id
      )
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      SELECT id, 'Entra Workspace', 'entra-workspace', 'free', false
      FROM org
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantRows[0]!.id}, ${userRows[0]!.id}, 'producer')`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      SELECT organization_id, ${userRows[0]!.id}, 'member', 'selected_workspaces'
      FROM public.tenants
      WHERE id = ${tenantRows[0]!.id}`;
    await dbHandle.sql`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )`;

    const start = await app.inject({
      method: 'GET',
      url: '/auth/oidc/entra/start?redirectTo=%2Fattestations',
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const authorizationUrl = new URL(startBody.authorizationUrl);
    const state = authorizationUrl.searchParams.get('state');
    const nonce = authorizationUrl.searchParams.get('nonce');
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const kid = 'test-key';
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    jwk.kid = kid;
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const now = Math.floor(Date.now() / 1000);
    const idToken = signedRs256Jwt({
      kid,
      privateKey,
      claims: {
        iss: 'https://login.microsoftonline.com/common/v2.0',
        aud: 'client-id',
        exp: now + 300,
        iat: now,
        nonce,
        sub: 'entra-subject-1',
        email: 'entra-user@example.com',
        email_verified: true,
        name: 'Entra User',
      },
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/keys')) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected_url' }), {
        status: 404,
      });
    });

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/oidc/entra/callback?code=auth-code&state=${state}`,
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/attestations');
    expect(callback.headers['set-cookie']).toBeDefined();

    const identities = await dbHandle.sql<
      {
        provider_subject: string;
        email: string;
        email_verified: boolean;
      }[]
    >`SELECT provider_subject, email, email_verified FROM public.external_identities`;
    expect(identities).toEqual([
      {
        provider_subject: 'entra-subject-1',
        email: 'entra-user@example.com',
        email_verified: true,
      },
    ]);

    const sessions = await dbHandle.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM public.sessions`;
    expect(sessions[0]!.count).toBe('1');

    const auditRows = await dbHandle.sql<
      { tenant_id: string | null; action: string; payload: unknown }[]
    >`
      SELECT tenant_id, action, payload
      FROM audit.audit_events
      WHERE action IN ('oidc.sign_in_succeeded', 'external_identity.connected')
      ORDER BY created_at`;
    expect(auditRows).toEqual([
      expect.objectContaining({
        tenant_id: tenantRows[0]!.id,
        action: 'oidc.sign_in_succeeded',
        payload: expect.objectContaining({
          provider: 'entra',
          providerDisplayName: 'Microsoft Entra ID',
          email: 'entra-user@example.com',
        }),
      }),
      expect.objectContaining({
        tenant_id: tenantRows[0]!.id,
        action: 'external_identity.connected',
        payload: expect.objectContaining({
          provider: 'entra',
          providerDisplayName: 'Microsoft Entra ID',
          email: 'entra-user@example.com',
        }),
      }),
    ]);
  });

  it('rejects a replayed state after callback consumption', async () => {
    await dbHandle.sql`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )`;

    const start = await app.inject({
      method: 'GET',
      url: '/auth/oidc/entra/start',
    });
    const state = new URL(
      (start.json() as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get('state');

    await dbHandle.sql`
      UPDATE public.oidc_auth_states SET consumed_at = now()`;

    const replay = await app.inject({
      method: 'GET',
      url: `/auth/oidc/entra/callback?code=auth-code&state=${state}`,
    });

    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: 'oidc_invalid_state' });
  });
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('creates a user, session cookie, and verification token without auto-creating a tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'Alice@Example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Alice',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      user: { email: string; displayName: string | null };
      tenant: null;
    };
    // Email is normalized to lowercase on insert.
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.displayName).toBe('Alice');
    expect(body.tenant).toBeNull();
    // Set-Cookie present and signed.
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    // Notification emitted for email verification.
    expect(notificationLines).toHaveLength(1);
    expect(notificationLines[0]).toContain('email_verification');
  });

  it('rejects duplicate email with 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'bob@example.com', password: 'password123' },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'BOB@example.com', password: 'differentpw' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rejects malformed email with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects short passwords via schema validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'x@y.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------
  // Invitation-driven registration (producers + consumers join this way;
  // no personal tenant is created). Invitations are seeded via SQL so
  // this test file doesn't need to register tenantPlugin.
  // -------------------------------------------------------------------

  const seedInvitation = async (
    invitedEmail: string,
    role: 'producer' | 'consumer' | 'tenant_admin' = 'producer',
  ): Promise<{ token: string; tenantId: string }> => {
    // Owner self-registers to create an inviting tenant.
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'inviter@example.com', password: 'password123' },
    });
    const ownerRow = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'inviter@example.com' LIMIT 1`;
    const ownerId = ownerRow[0]!.id;
    const tenantRow = await dbHandle.sql<{ id: string }[]>`
      WITH org AS (
        INSERT INTO public.organizations (name)
        VALUES ('Inviter Workspace')
        RETURNING id
      )
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      SELECT id, 'Inviter Workspace', 'inviter-workspace', 'free', false
      FROM org
      RETURNING id`;
    const tenantId = tenantRow[0]!.id;
    await dbHandle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantId}, ${ownerId}, 'tenant_admin')`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      SELECT organization_id, ${ownerId}, 'organization_admin', 'selected_workspaces'
      FROM public.tenants
      WHERE id = ${tenantId}`;

    // Build a token + hash the same way the api does, insert the row.
    const { token, hash } = (
      await import('./tokens.js')
    ).generateToken();
    const expiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    await dbHandle.sql`
      INSERT INTO public.tenant_invitations
        (tenant_id, invited_by_user_id, email, role, token_hash, expires_at)
      VALUES (${tenantId}, ${ownerId}, ${invitedEmail}, ${role}, ${hash}, ${expiresAt})`;
    return { token, tenantId };
  };

  it('with an invitationToken: no personal tenant, joins inviting tenant with invited role', async () => {
    const { token, tenantId } = await seedInvitation('producer@example.com');

    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'producer@example.com',
        password: 'password123',
        invitationToken: token,
      },
    });
    expect(reg.statusCode).toBe(201);
    const regBody = reg.json() as {
      tenant: { id: string };
    };
    // Returned tenant is the INVITING tenant, not a fresh personal one.
    expect(regBody.tenant.id).toBe(tenantId);

    // No second tenant was created for the producer.
    const memberships = await dbHandle.sql<
      { tenant_id: string; role: string }[]
    >`
      SELECT tenant_id, role FROM public.tenant_memberships
       WHERE user_id = (SELECT id FROM public.users WHERE email = 'producer@example.com')`;
    expect(memberships.length).toBe(1);
    expect(memberships[0]!.role).toBe('producer');
    expect(memberships[0]!.tenant_id).toBe(tenantId);
    const orgMemberships = await dbHandle.sql<
      { workspace_access_mode: string; org_role: string }[]
    >`
      SELECT workspace_access_mode, org_role
      FROM public.organization_memberships
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'producer@example.com')`;
    expect(orgMemberships).toEqual([
      { workspace_access_mode: 'selected_workspaces', org_role: 'member' },
    ]);

    // The invitation was marked accepted.
    const inv = await dbHandle.sql<{ accepted_at: Date | null }[]>`
      SELECT accepted_at FROM public.tenant_invitations
       WHERE email = 'producer@example.com' LIMIT 1`;
    expect(inv[0]!.accepted_at).not.toBeNull();

    const auditRows = await dbHandle.sql<{ action: string; tenant_id: string }[]>`
      SELECT action, tenant_id
      FROM audit.audit_events
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at`;
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'user.registered',
        'session.created',
        'tenant_invitation.accepted',
        'tenant_member.added',
      ]),
    );
    expect(
      auditRows.filter((row) =>
        [
          'user.registered',
          'session.created',
          'tenant_invitation.accepted',
          'tenant_member.added',
        ].includes(row.action),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenant_id: tenantId }),
      ]),
    );
  });

  it('rejects invitation-driven register when the token email does not match', async () => {
    const { token } = await seedInvitation('invited@example.com');
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'someone-else@example.com',
        password: 'password123',
        invitationToken: token,
      },
    });
    expect(reg.statusCode).toBe(403);
    expect((reg.json() as { error: string }).error).toBe(
      'invitation_email_mismatch',
    );
  });

  it('rejects invitation-driven register when the token is invalid / expired / revoked', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'nope@example.com',
        password: 'password123',
        invitationToken: 'totally-fake-token-1234567890',
      },
    });
    expect(reg.statusCode).toBe(400);
    expect((reg.json() as { error: string }).error).toBe(
      'invalid_or_expired_invitation',
    );
  });
});

// ---------------------------------------------------------------------------
// login / logout / me
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  it('logs in with correct credentials and sets a session cookie', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'carol@example.com', password: 'password123' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'carol@example.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { email: string } };
    expect(body.user.email).toBe('carol@example.com');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects wrong password with 401', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dave@example.com', password: 'password123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dave@example.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown email with 401 (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/device/mint', () => {
  const createWorkspaceFor = async (
    email: string,
    role: 'tenant_admin' | 'producer' | 'consumer' = 'tenant_admin',
  ): Promise<string> => {
    const [user] = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = ${email} LIMIT 1`;
    if (!user) throw new Error(`missing user ${email}`);
    const slug = email.split('@')[0] ?? 'user';
    const [tenant] = await dbHandle.sql<{ id: string }[]>`
      WITH org AS (
        INSERT INTO public.organizations (name)
        VALUES (${email})
        RETURNING id
      )
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      SELECT id, ${email}, ${slug}, 'free', false
      FROM org
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenant!.id}, ${user.id}, ${role})`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      SELECT
        organization_id,
        ${user.id},
        ${role === 'tenant_admin' ? 'organization_admin' : 'member'},
        'selected_workspaces'
      FROM public.tenants
      WHERE id = ${tenant!.id}`;
    return tenant!.id;
  };

  it('registers a device row and returns the device id when credentials + single membership are valid', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'mint@example.com', password: 'password123' },
    });
    await createWorkspaceFor('mint@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/device/mint',
      payload: {
        email: 'mint@example.com',
        password: 'password123',
        publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        deviceName: 'QA Mac',
        platform: 'darwin',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      device: { id: string; platform: string };
      user: { email: string };
      tenant: {
        id: string;
        slug: string;
        name: string;
        plan: string;
        role: string;
        organizationId: string;
      };
      organizations: Array<{
        id: string;
        name: string;
        role: string;
        workspaceAccessMode: string;
      }>;
      workspaces: Array<{
        id: string;
        slug: string;
        name: string;
        plan: string;
        role: string;
        organizationId: string;
      }>;
    };
    expect(body.device.id).toMatch(/^[0-9a-f-]+$/);
    expect(body.device.platform).toBe('darwin');
    expect(body.user.email).toBe('mint@example.com');
    expect(body.tenant.slug).toBe('mint');
    expect(body.tenant.plan).toBe('free');
    expect(body.tenant.role).toBe('tenant_admin');
    expect(body.tenant.organizationId).toBeTruthy();
    expect(body.organizations).toEqual([
      {
        id: body.tenant.organizationId,
        name: 'mint@example.com',
        projectNoun: 'Project',
        role: 'organization_admin',
        workspaceAccessMode: 'selected_workspaces',
      },
    ]);
    expect(body.workspaces).toEqual([
      {
        id: body.tenant.id,
        slug: 'mint',
        name: 'mint@example.com',
        plan: 'free',
        projectNoun: 'Project',
        role: 'tenant_admin',
        archivedAt: null,
        organizationId: body.tenant.organizationId,
      },
    ]);
  });

  it('returns the caller membership role for producer desktop sessions', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'mint-producer@example.com', password: 'password123' },
    });
    await createWorkspaceFor('mint-producer@example.com', 'producer');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/device/mint',
      payload: {
        email: 'mint-producer@example.com',
        password: 'password123',
        publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        deviceName: 'QA Mac',
        platform: 'darwin',
      },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as { tenant: { role: string } }).tenant.role).toBe(
      'producer',
    );
  });

  it('returns all available workspaces for all-workspace organization members', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'mint-multi@example.com', password: 'password123' },
    });
    const [user] = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'mint-multi@example.com' LIMIT 1`;
    if (!user) throw new Error('missing multi-workspace user');
    const [organization] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.organizations (name)
      VALUES ('Mint Multi Org')
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      VALUES
        (${organization!.id}, 'Mint Workspace One', 'mint-workspace-one', 'team_pro', false),
        (${organization!.id}, 'Mint Workspace Two', 'mint-workspace-two', 'team_pro', false)`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      VALUES (${organization!.id}, ${user.id}, 'organization_admin', 'all_workspaces')`;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/device/mint',
      payload: {
        email: 'mint-multi@example.com',
        password: 'password123',
        publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        deviceName: 'QA Mac',
        platform: 'darwin',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      tenant: { slug: string };
      workspaces: Array<{ slug: string; role: string }>;
    };
    expect(body.tenant.slug).toBe('mint-workspace-one');
    expect(body.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'mint-workspace-one',
          role: 'tenant_admin',
        }),
        expect.objectContaining({
          slug: 'mint-workspace-two',
          role: 'tenant_admin',
        }),
      ]),
    );
  });

  it('rejects a wrong password with 401', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'mint2@example.com', password: 'password123' },
    });
    await createWorkspaceFor('mint2@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/device/mint',
      payload: {
        email: 'mint2@example.com',
        password: 'wrong',
        publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        deviceName: 'QA Mac',
        platform: 'darwin',
      },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('invalid_credentials');
  });

  it('rejects users with no tenant membership (consumers) with 403', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'lonely@example.com', password: 'password123' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/device/mint',
      payload: {
        email: 'lonely@example.com',
        password: 'password123',
        publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        deviceName: 'QA Mac',
        platform: 'darwin',
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('no_tenant_membership');
  });
});

describe('GET /auth/me + POST /auth/logout', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the user and memberships when authenticated', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'erin@example.com',
        password: 'password123',
        displayName: 'Erin',
      },
    });
    const cookies = cookieHeader(reg);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookies },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      user: { email: string };
      memberships: { role: string; plan: string }[];
      organizations: unknown[];
      workspaces: unknown[];
    };
    expect(body.user.email).toBe('erin@example.com');
    expect(body.memberships).toHaveLength(0);
    expect(body.organizations).toEqual([]);
    expect(body.workspaces).toEqual([]);
  });

  it('returns organization and workspace choices for workspace members', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'workspace-member@example.com',
        password: 'password123',
      },
    });
    const cookies = cookieHeader(reg);
    const user = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'workspace-member@example.com' LIMIT 1`;
    const [organization] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.organizations (name)
      VALUES ('Workspace Member Org')
      RETURNING id`;
    const [tenant] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      VALUES (${organization!.id}, 'Workspace Member Workspace', 'workspace-member-workspace', 'team_pro', false)
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      VALUES (${organization!.id}, ${user[0]!.id}, 'organization_admin', 'selected_workspaces')`;
    await dbHandle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenant!.id}, ${user[0]!.id}, 'tenant_admin')`;

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookies },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      organizations: Array<{
        id: string;
        name: string;
        role: string;
        workspaceAccessMode: string;
      }>;
      workspaces: Array<{
        id: string;
        slug: string;
        name: string;
        plan: string;
        role: string;
        organizationId: string;
      }>;
      memberships: Array<{ tenantId: string; organizationId: string }>;
    };
    expect(body.organizations).toEqual([
      {
        id: organization!.id,
        name: 'Workspace Member Org',
        projectNoun: 'Project',
        role: 'organization_admin',
        workspaceAccessMode: 'selected_workspaces',
      },
    ]);
    expect(body.workspaces).toEqual([
      {
        id: tenant!.id,
        slug: 'workspace-member-workspace',
        name: 'Workspace Member Workspace',
        plan: 'team_pro',
        projectNoun: 'Project',
        role: 'tenant_admin',
        archivedAt: null,
        organizationId: organization!.id,
      },
    ]);
    expect(body.memberships[0]?.organizationId).toBe(organization!.id);
  });

  it('hides workspaces when organization access is revoked', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'revoked-workspace@example.com',
        password: 'password123',
      },
    });
    const cookies = cookieHeader(reg);
    const user = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'revoked-workspace@example.com' LIMIT 1`;
    const [organization] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.organizations (name)
      VALUES ('Revoked Workspace Org')
      RETURNING id`;
    const [tenant] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      VALUES (${organization!.id}, 'Revoked Workspace', 'revoked-workspace', 'team_pro', false)
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode, revoked_at)
      VALUES (${organization!.id}, ${user[0]!.id}, 'member', 'none', now())`;
    await dbHandle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenant!.id}, ${user[0]!.id}, 'producer')`;

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookies },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      organizations: unknown[];
      workspaces: unknown[];
      memberships: unknown[];
    };
    expect(body.organizations).toEqual([]);
    expect(body.workspaces).toEqual([]);
    expect(body.memberships).toEqual([]);
  });

  it('lists all organization workspaces for all-workspace access', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'all-workspaces@example.com',
        password: 'password123',
      },
    });
    const cookies = cookieHeader(reg);
    const user = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'all-workspaces@example.com' LIMIT 1`;
    const [organization] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.organizations (name)
      VALUES ('All Workspace Org')
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      VALUES
        (${organization!.id}, 'Workspace One', 'workspace-one', 'team_pro', false),
        (${organization!.id}, 'Workspace Two', 'workspace-two', 'team_pro', false)`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      VALUES (${organization!.id}, ${user[0]!.id}, 'member', 'all_workspaces')`;

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookies },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      organizations: Array<{ workspaceAccessMode: string }>;
      workspaces: Array<{ slug: string; role: string }>;
    };
    expect(body.organizations).toEqual([
      expect.objectContaining({ workspaceAccessMode: 'all_workspaces' }),
    ]);
    expect(body.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'workspace-one', role: 'producer' }),
        expect.objectContaining({ slug: 'workspace-two', role: 'producer' }),
      ]),
    );
  });

  it('revokes the session on logout — subsequent /auth/me returns 401', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'frank@example.com', password: 'password123' },
    });
    const cookies = cookieHeader(reg);

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookies },
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookies },
    });
    expect(me.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// email verification
// ---------------------------------------------------------------------------

describe('email verification flow', () => {
  it('consume sets user.email_verified_at and the token cannot be reused', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'gina@example.com', password: 'password123' },
    });
    expect(reg.statusCode).toBe(201);
    const token = extractToken(notificationLines[0] ?? '');

    const first = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/consume',
      payload: { token },
    });
    expect(first.statusCode).toBe(204);

    // me should now show email_verified_at populated.
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookieHeader(reg) },
    });
    const body = me.json() as { user: { emailVerifiedAt: string | null } };
    expect(body.user.emailVerifiedAt).not.toBeNull();

    // Replay: token is consumed.
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/consume',
      payload: { token },
    });
    expect(replay.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// password reset
// ---------------------------------------------------------------------------

describe('password reset flow', () => {
  it('request always 202; consume updates password and revokes existing sessions', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'hank@example.com', password: 'old-password-1' },
    });
    const oldCookies = cookieHeader(reg);
    notificationLines.length = 0; // drop the email-verification line

    const req = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'hank@example.com' },
    });
    expect(req.statusCode).toBe(202);
    expect(notificationLines).toHaveLength(1);
    expect(notificationLines[0]).toContain('password_reset');
    const token = extractToken(notificationLines[0] ?? '');

    const consume = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/consume',
      payload: { token, newPassword: 'new-password-2' },
    });
    expect(consume.statusCode).toBe(204);

    // Old session should be revoked.
    const meOld = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: oldCookies },
    });
    expect(meOld.statusCode).toBe(401);

    // Login works with the new password.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'hank@example.com', password: 'new-password-2' },
    });
    expect(login.statusCode).toBe(200);

    // Old password no longer works.
    const badLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'hank@example.com', password: 'old-password-1' },
    });
    expect(badLogin.statusCode).toBe(401);
  });

  it('request for unknown email still returns 202 (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(202);
    expect(notificationLines).toHaveLength(0);
  });
});
