// /auth/* routes: register, login, logout, me, verify-email, password-reset.
// All routes that mutate state write an audit row via @proveria/audit categories.

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import { randomUUID } from 'node:crypto';

import {
  attestationAccessGrants,
  devices,
  emailVerificationTokens,
  externalIdentities,
  oidcAuthStates,
  oidcIdentityProviders,
  organizationMemberships,
  organizations,
  passwordResetTokens,
  sessions as sessionsTable,
  tenantInvitations,
  tenantMemberships,
  tenants,
  users,
  type DrizzleClient,
  type Role,
  type User,
} from '@proveria/db';

import { config, isProduction } from '../config.js';
import { writeAuditEvent } from '../audit/writer.js';
import type { NotificationProvider } from '../notifications/provider.js';
import {
  createSession,
  revokeSession,
  sessionCookieMaxAgeSeconds,
} from './sessions.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { requireSessionFactory } from './session-hook.js';
import { generateToken, hashToken } from './tokens.js';
import {
  buildAuthorizationUrl,
  exchangeOidcCode,
  findEnabledOidcProvider,
  publicOidcProvider,
  randomBase64Url,
  sha256Base64Url,
  sha256Hex,
  syncConfiguredOidcProviders,
  verifyOidcIdToken,
} from './oidc.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface AuthPluginOptions {
  db: DrizzleClient;
  notifications: NotificationProvider;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COOKIE_OPTIONS = (): {
  signed: true;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} => ({
  signed: true,
  httpOnly: true,
  secure: isProduction(),
  sameSite: 'lax',
  path: '/',
  maxAge: sessionCookieMaxAgeSeconds(),
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const emailLooksValid = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const redirectPathLooksSafe = (value: string): boolean =>
  value.startsWith('/') && !value.startsWith('//');

const oidcEmailFromClaims = (claims: {
  email?: string;
  preferred_username?: string;
}): string | null => {
  const raw = claims.email ?? claims.preferred_username;
  if (!raw) return null;
  const normalized = normalizeEmail(raw);
  return emailLooksValid(normalized) ? normalized : null;
};

const oidcEmailDomainAllowed = (email: string, domains: string[]): boolean => {
  if (domains.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return Boolean(domain && domains.map((d) => d.toLowerCase()).includes(domain));
};

const deviceMintResponse = (input: {
  user: User;
  device: typeof devices.$inferSelect;
  tenant: WorkspaceChoice;
  organizations: OrganizationSummary[];
  workspaces: WorkspaceChoice[];
}) => ({
  device: {
    id: input.device.id,
    name: input.device.name,
    platform: input.device.platform,
  },
  user: publicUser(input.user),
  tenant: {
    id: input.tenant.tenantId,
    slug: input.tenant.slug,
    name: input.tenant.name,
    plan: input.tenant.plan,
    projectNoun:
      input.tenant.organizationProjectNoun ??
      input.tenant.projectNoun ??
      'Project',
    role: input.tenant.role,
    organizationId: input.tenant.organizationId,
  },
  organizations: input.organizations,
  workspaces: input.workspaces.map((m) => ({
    id: m.tenantId,
    slug: m.slug,
    name: m.name,
    plan: m.plan,
    projectNoun: m.organizationProjectNoun ?? m.projectNoun ?? 'Project',
    role: m.role,
    archivedAt: m.archivedAt?.toISOString() ?? null,
    organizationId: m.organizationId,
  })),
});

const clientIp = (req: { ip?: string; ips?: string[] }): string | null => {
  return req.ips?.[0] ?? req.ip ?? null;
};

const userAgent = (req: { headers: Record<string, unknown> }): string | null => {
  const raw = req.headers['user-agent'];
  return typeof raw === 'string' ? raw.slice(0, 512) : null;
};

interface WorkspaceChoice {
  tenantId: string;
  role: Role;
  slug: string;
  plan: string;
  name: string;
  projectNoun: string | null;
  archivedAt: Date | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationProjectNoun: string | null;
  organizationRole: string | null;
  workspaceAccessMode: string | null;
}

interface OrganizationSummary {
  id: string;
  name: string;
  role: string;
  projectNoun: string;
  workspaceAccessMode: string;
}

const workspaceRoleForOrganizationRole = (role: string | null): Role =>
  role === 'organization_admin' ? 'tenant_admin' : 'producer';

const minutesFromNow = (minutes: number): Date =>
  new Date(Date.now() + minutes * 60 * 1000);

const setSessionCookie = (
  reply: FastifyReply,
  sessionId: string,
): void => {
  reply.setCookie(config.sessionCookieName, sessionId, COOKIE_OPTIONS());
};

const clearSessionCookie = (reply: FastifyReply): void => {
  reply.clearCookie(config.sessionCookieName, { path: '/' });
};

const publicUser = (
  user: User,
): {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
} => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  emailVerifiedAt: user.emailVerifiedAt
    ? user.emailVerifiedAt.toISOString()
    : null,
  createdAt: user.createdAt.toISOString(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (
  app,
  opts,
) => {
  const { db, notifications } = opts;

  app.decorateRequest('currentUser', undefined);
  app.decorateRequest('currentSessionId', undefined);

  const requireSession = requireSessionFactory(db);
  await syncConfiguredOidcProviders(db);

  const resolveWorkspaceChoices = async (
    user: User,
  ): Promise<WorkspaceChoice[]> => {
    const explicitRows = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        role: tenantMemberships.role,
        slug: tenants.slug,
        plan: tenants.plan,
        name: tenants.name,
        projectNoun: tenants.projectNoun,
        archivedAt: tenants.archivedAt,
        organizationId: tenants.organizationId,
        organizationName: organizations.name,
        organizationProjectNoun: organizations.projectNoun,
        organizationRole: organizationMemberships.orgRole,
        workspaceAccessMode: organizationMemberships.workspaceAccessMode,
        organizationRevokedAt: organizationMemberships.revokedAt,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .leftJoin(organizations, eq(organizations.id, tenants.organizationId))
      .leftJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, tenants.organizationId),
          eq(organizationMemberships.userId, user.id),
        ),
      )
      .where(eq(tenantMemberships.userId, user.id));

    const choices = new Map<string, WorkspaceChoice>();
    for (const row of explicitRows) {
      if (
        (row.archivedAt && row.organizationRole !== 'organization_admin') ||
        (row.organizationId &&
        (!row.workspaceAccessMode ||
          row.workspaceAccessMode === 'none' ||
          row.organizationRevokedAt))
      ) {
        continue;
      }
      choices.set(row.tenantId, {
        tenantId: row.tenantId,
        role: row.role,
        slug: row.slug,
        plan: row.plan,
        name: row.name,
        projectNoun: row.projectNoun,
        archivedAt: row.archivedAt,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        organizationProjectNoun: row.organizationProjectNoun,
        organizationRole: row.organizationRole,
        workspaceAccessMode: row.workspaceAccessMode,
      });
    }

    const allWorkspaceRows = await db
      .select({
        tenantId: tenants.id,
        explicitRole: tenantMemberships.role,
        slug: tenants.slug,
        plan: tenants.plan,
        name: tenants.name,
        projectNoun: tenants.projectNoun,
        archivedAt: tenants.archivedAt,
        organizationId: tenants.organizationId,
        organizationName: organizations.name,
        organizationProjectNoun: organizations.projectNoun,
        organizationRole: organizationMemberships.orgRole,
        workspaceAccessMode: organizationMemberships.workspaceAccessMode,
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMemberships.organizationId),
      )
      .innerJoin(tenants, eq(tenants.organizationId, organizations.id))
      .leftJoin(
        tenantMemberships,
        and(
          eq(tenantMemberships.tenantId, tenants.id),
          eq(tenantMemberships.userId, user.id),
        ),
      )
      .where(
        and(
          eq(organizationMemberships.userId, user.id),
          or(
            eq(organizationMemberships.workspaceAccessMode, 'all_workspaces'),
            eq(organizationMemberships.orgRole, 'organization_admin'),
          ),
          isNull(organizationMemberships.revokedAt),
        ),
      );

    for (const row of allWorkspaceRows) {
      if (row.archivedAt && row.organizationRole !== 'organization_admin') continue;
      if (choices.has(row.tenantId)) continue;
      choices.set(row.tenantId, {
        tenantId: row.tenantId,
        role:
          row.explicitRole ??
          workspaceRoleForOrganizationRole(row.organizationRole),
        slug: row.slug,
        plan: row.plan,
        name: row.name,
        projectNoun: row.projectNoun,
        archivedAt: row.archivedAt,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        organizationProjectNoun: row.organizationProjectNoun,
        organizationRole: row.organizationRole,
        workspaceAccessMode: row.workspaceAccessMode,
      });
    }

    return [...choices.values()];
  };

  // -----------------------------------------------------------------------
  // GET /auth/oidc/providers
  // -----------------------------------------------------------------------
  app.get('/auth/oidc/providers', async () => {
    const providers = await db
      .select()
      .from(oidcIdentityProviders)
      .where(eq(oidcIdentityProviders.enabled, true))
      .orderBy(asc(oidcIdentityProviders.displayName));
    return {
      providers: providers.map(publicOidcProvider),
    };
  });

  // -----------------------------------------------------------------------
  // GET /auth/oidc/:provider/start
  // -----------------------------------------------------------------------
  app.get(
    '/auth/oidc/:provider/start',
    {
      schema: {
        params: {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { type: 'string', minLength: 1, maxLength: 80 },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            redirectTo: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const { provider: providerSlug } = req.params as { provider: string };
      const { redirectTo } = req.query as { redirectTo?: string };
      if (redirectTo && !redirectPathLooksSafe(redirectTo)) {
        return reply.code(400).send({ error: 'invalid_redirect_to' });
      }
      const provider = await findEnabledOidcProvider(db, providerSlug);
      if (!provider) {
        return reply.code(404).send({ error: 'oidc_provider_not_found' });
      }

      const state = randomBase64Url();
      const nonce = randomBase64Url();
      const codeVerifier = randomBase64Url(48);
      const codeChallenge = sha256Base64Url(codeVerifier);
      const expiresAt = minutesFromNow(config.oidc.stateTtlMinutes);

      await db.insert(oidcAuthStates).values({
        providerId: provider.id,
        stateHash: sha256Hex(state),
        nonceHash: sha256Hex(nonce),
        codeVerifier,
        codeChallenge,
        redirectTo: redirectTo ?? null,
        expiresAt,
      });

      return {
        provider: publicOidcProvider(provider),
        authorizationUrl: buildAuthorizationUrl({
          provider,
          state,
          nonce,
          codeChallenge,
        }),
        expiresAt: expiresAt.toISOString(),
      };
    },
  );

  const mintDesktopDevice = async (input: {
    user: User;
    publicKey: string;
    deviceName: string;
    platform: 'darwin' | 'win32';
    appVersion?: string;
  }) => {
    const memberships = await resolveWorkspaceChoices(input.user);
    if (memberships.length === 0) {
      return { error: 'no_tenant_membership' as const };
    }
    const workspace = memberships[0]!;
    const [inserted] = await db
      .insert(devices)
      .values({
        tenantId: workspace.tenantId,
        userId: input.user.id,
        profileId: randomUUID(),
        publicKey: input.publicKey,
        name: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion ?? '0.0.0',
      })
      .returning();
    if (!inserted) {
      throw new Error('device row insert returned nothing');
    }

    await writeAuditEvent(db, {
      tenantId: workspace.tenantId,
      actorUserId: input.user.id,
      actorDeviceId: inserted.id,
      category: AUDIT_CATEGORIES.devicePairing,
      action: AUDIT_ACTIONS.deviceMinted,
      targetType: 'device',
      targetId: inserted.id,
      payload: { deviceName: input.deviceName, platform: input.platform },
    });

    return {
      device: inserted,
      tenant: workspace,
      organizations: workspace.organizationId
        ? [
            {
              id: workspace.organizationId,
              name: workspace.organizationName ?? workspace.name,
              projectNoun: workspace.organizationProjectNoun ?? 'Project',
              role: workspace.organizationRole ?? 'member',
              workspaceAccessMode:
                workspace.workspaceAccessMode ?? 'selected_workspaces',
            },
          ]
        : [],
      workspaces: memberships,
    };
  };

  // -----------------------------------------------------------------------
  // GET /auth/oidc/:provider/callback
  // -----------------------------------------------------------------------
  app.get(
    '/auth/oidc/:provider/callback',
    {
      schema: {
        params: {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { type: 'string', minLength: 1, maxLength: 80 },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: true,
          required: ['state'],
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 4096 },
            state: { type: 'string', minLength: 10, maxLength: 512 },
            error: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { provider: providerSlug } = req.params as { provider: string };
      const query = req.query as {
        code?: string;
        state: string;
        error?: string;
      };
      const provider = await findEnabledOidcProvider(db, providerSlug);
      if (!provider) {
        return reply.code(404).send({ error: 'oidc_provider_not_found' });
      }
      if (query.error) {
        await writeAuditEvent(db, {
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.oidcSignInFailed,
          payload: { provider: provider.slug, error: query.error },
        });
        return reply.code(400).send({ error: 'oidc_provider_error' });
      }
      if (!query.code) {
        return reply.code(400).send({ error: 'oidc_missing_code' });
      }

      const stateHash = sha256Hex(query.state);
      const stateRows = await db
        .select()
        .from(oidcAuthStates)
        .where(eq(oidcAuthStates.stateHash, stateHash))
        .limit(1);
      const state = stateRows[0];
      if (
        !state ||
        state.providerId !== provider.id ||
        state.consumedAt ||
        state.expiresAt.getTime() < Date.now()
      ) {
        await writeAuditEvent(db, {
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.oidcSignInFailed,
          payload: { provider: provider.slug, error: 'invalid_state' },
        });
        return reply.code(400).send({ error: 'oidc_invalid_state' });
      }

      await db
        .update(oidcAuthStates)
        .set({ consumedAt: new Date() })
        .where(eq(oidcAuthStates.id, state.id));

      try {
        const { idToken } = await exchangeOidcCode({
          provider,
          code: query.code,
          codeVerifier: state.codeVerifier,
        });
        const claims = await verifyOidcIdToken({
          provider,
          idToken,
          nonceHash: state.nonceHash,
        });
        const email = oidcEmailFromClaims(claims);
        if (!email) {
          throw new Error('oidc_missing_email');
        }
        if (!oidcEmailDomainAllowed(email, provider.allowedDomains)) {
          throw new Error('oidc_email_domain_not_allowed');
        }

        const connectUser =
          state.flow === 'connect' && state.connectUserId
            ? (
                await db
                  .select()
                  .from(users)
                  .where(eq(users.id, state.connectUserId))
                  .limit(1)
              )[0]
            : null;
        if (
          state.flow === 'connect' &&
          (!connectUser || connectUser.deactivatedAt)
        ) {
          throw new Error('oidc_connect_user_unavailable');
        }

        const identityResult = await db.transaction(async (tx) => {
          const identityRows = await tx
            .select({ user: users, identity: externalIdentities })
            .from(externalIdentities)
            .innerJoin(users, eq(users.id, externalIdentities.userId))
            .where(
              and(
                eq(externalIdentities.providerId, provider.id),
                eq(externalIdentities.providerSubject, claims.sub),
              ),
            )
            .limit(1);
          const existingIdentity = identityRows[0];
          if (existingIdentity) {
            if (connectUser && existingIdentity.user.id !== connectUser.id) {
              throw new Error('oidc_identity_already_linked');
            }
            await tx
              .update(externalIdentities)
              .set({
                email,
                emailVerified: claims.email_verified === true,
                displayName:
                  typeof claims.name === 'string'
                    ? claims.name
                    : existingIdentity.identity.displayName,
                avatarUrl:
                  typeof claims.picture === 'string'
                    ? claims.picture
                    : existingIdentity.identity.avatarUrl,
                lastSeenAt: new Date(),
                disconnectedAt: null,
                claims,
              })
              .where(eq(externalIdentities.id, existingIdentity.identity.id));
            return {
              user: existingIdentity.user,
              externalIdentityId: existingIdentity.identity.id,
              connectedNewIdentity: Boolean(
                existingIdentity.identity.disconnectedAt,
              ),
              createdNewUser: false,
            };
          }

          let user = connectUser ?? null;
          let createdNewUser = false;
          if (!user) {
            const existingUsers = await tx
              .select()
              .from(users)
              .where(eq(users.email, email))
              .limit(1);
            user = existingUsers[0] ?? null;
            if (!user) {
              const passwordHash = await hashPassword(randomBase64Url(48));
              const userRows = await tx
                .insert(users)
                .values({
                  email,
                  passwordHash,
                  displayName:
                    typeof claims.name === 'string' ? claims.name : null,
                  emailVerifiedAt: new Date(),
                })
                .returning();
              user = userRows[0] ?? null;
              if (!user) throw new Error('failed_to_create_oidc_user');
              createdNewUser = true;
            }
          }

          const [identity] = await tx
            .insert(externalIdentities)
            .values({
              userId: user.id,
              providerId: provider.id,
              providerSubject: claims.sub,
              email,
              emailVerified: claims.email_verified === true,
              displayName: typeof claims.name === 'string' ? claims.name : null,
              avatarUrl:
                typeof claims.picture === 'string' ? claims.picture : null,
              claims,
              lastSeenAt: new Date(),
            })
            .returning({ id: externalIdentities.id });
          if (!identity) throw new Error('failed_to_link_external_identity');
          return {
            user,
            externalIdentityId: identity.id,
            connectedNewIdentity: true,
            createdNewUser,
          };
        });
        const { user } = identityResult;

        const session = await createSession(db, {
          userId: user.id,
          ip: clientIp(req),
          userAgent: userAgent(req),
        });
        setSessionCookie(reply, session.id);
        const auditWorkspace = (await resolveWorkspaceChoices(user))[0] ?? null;

        if (identityResult.createdNewUser) {
          await writeAuditEvent(db, {
            tenantId: auditWorkspace?.tenantId ?? null,
            actorUserId: user.id,
            category: AUDIT_CATEGORIES.identitySession,
            action: AUDIT_ACTIONS.userRegistered,
            targetType: 'user',
            targetId: user.id,
            payload: { source: 'oidc', provider: provider.slug, email },
          });
        }

        await writeAuditEvent(db, {
          tenantId: auditWorkspace?.tenantId ?? null,
          actorUserId: user.id,
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.oidcSignInSucceeded,
          targetType: 'session',
          targetId: session.id,
          payload: {
            provider: provider.slug,
            providerDisplayName: provider.displayName,
            email,
          },
        });
        await writeAuditEvent(db, {
          tenantId: auditWorkspace?.tenantId ?? null,
          actorUserId: user.id,
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.sessionCreated,
          targetType: 'session',
          targetId: session.id,
          payload: { source: 'oidc', provider: provider.slug },
        });

        if (identityResult.connectedNewIdentity) {
          await writeAuditEvent(db, {
            tenantId: auditWorkspace?.tenantId ?? null,
            actorUserId: user.id,
            category: AUDIT_CATEGORIES.identitySession,
            action: AUDIT_ACTIONS.externalIdentityConnected,
            targetType: 'external_identity',
            targetId: identityResult.externalIdentityId,
            payload: {
              provider: provider.slug,
              providerDisplayName: provider.displayName,
              email,
            },
          });
        }

        return reply.redirect(state.redirectTo ?? '/', 302);
      } catch (err) {
        await writeAuditEvent(db, {
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.oidcSignInFailed,
          payload: {
            provider: provider.slug,
            error: err instanceof Error ? err.message : 'unknown',
          },
        });
        return reply.code(400).send({ error: 'oidc_callback_failed' });
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/register
  // -----------------------------------------------------------------------
  app.post(
    '/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 8, maxLength: 1024 },
            displayName: { type: 'string', maxLength: 200 },
            // When present, the registration is invitation-driven: no
            // personal tenant is created; the user is added as a member
            // of the inviting tenant with the invitation's role. Producers
            // arrive this way.
            invitationToken: {
              type: 'string',
              minLength: 10,
              maxLength: 200,
            },
            // When present, the registration is grant-driven: no personal
            // tenant is created; the matching pending attestation-access
            // grant is claimed. Consumers arrive this way.
            grantToken: {
              type: 'string',
              minLength: 10,
              maxLength: 200,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password, displayName, invitationToken, grantToken } =
        req.body as {
          email: string;
          password: string;
          displayName?: string;
          invitationToken?: string;
          grantToken?: string;
        };
      const normalizedEmail = normalizeEmail(email);
      if (!emailLooksValid(normalizedEmail)) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (invitationToken && grantToken) {
        // A given registration is one path or the other — not both. Choose
        // up front so the user gets a clear 400 instead of mysterious flow
        // (we'd otherwise honor invitation and silently leave the grant
        // unclaimed).
        return reply
          .code(400)
          .send({ error: 'invitation_and_grant_token_conflict' });
      }

      // Check for an existing user. Return a generic conflict to avoid
      // enumeration on this route (which is unauthenticated).
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      if (existing[0]) {
        return reply.code(409).send({ error: 'email_taken' });
      }

      const passwordHash = await hashPassword(password);

      // Three registration paths:
      //   - With invitationToken: invited-member flow. No personal tenant.
      //     The user becomes a member of the inviting tenant with the
      //     invitation's role. Used by producers.
      //   - With grantToken: grant-claim flow. No personal tenant. The
      //     pending attestation-access grant is claimed (granted_to_user_id
      //     + claimed_at filled in). The user has zero tenant memberships
      //     — they are a "consumer" by definition. Used by consumers.
      //   - Without either: self-register flow. No tenant is created here.
      //     The desktop explicitly creates the first workspace next via
      //     POST /tenants.
      let invitationToHonor:
        | typeof tenantInvitations.$inferSelect
        | null = null;
      if (invitationToken) {
        const tokenHash = hashToken(invitationToken);
        const rows = await db
          .select()
          .from(tenantInvitations)
          .where(eq(tenantInvitations.tokenHash, tokenHash))
          .limit(1);
        const inv = rows[0];
        if (
          !inv ||
          inv.acceptedAt ||
          inv.revokedAt ||
          inv.expiresAt.getTime() < Date.now()
        ) {
          return reply
            .code(400)
            .send({ error: 'invalid_or_expired_invitation' });
        }
        if (inv.email !== normalizedEmail) {
          return reply.code(403).send({ error: 'invitation_email_mismatch' });
        }
        invitationToHonor = inv;
      }

      let grantToHonor:
        | typeof attestationAccessGrants.$inferSelect
        | null = null;
      if (grantToken) {
        const tokenHash = hashToken(grantToken);
        const rows = await db
          .select()
          .from(attestationAccessGrants)
          .where(eq(attestationAccessGrants.tokenHash, tokenHash))
          .limit(1);
        const g = rows[0];
        if (!g || g.revokedAt || g.claimedAt) {
          return reply.code(400).send({ error: 'invalid_or_expired_grant' });
        }
        if (g.grantedToEmail !== normalizedEmail) {
          return reply.code(403).send({ error: 'grant_email_mismatch' });
        }
        grantToHonor = g;
      }

      const { user, tenant } = await db.transaction(async (tx) => {
        const userRows = await tx
          .insert(users)
          .values({
            email: normalizedEmail,
            passwordHash,
            displayName: displayName ?? null,
          })
          .returning();
        const userRow = userRows[0];
        if (!userRow) throw new Error('failed to insert user');

        if (invitationToHonor) {
          // Invitation-driven path: no personal tenant. Join the inviting
          // tenant + consume the invitation.
          await tx.insert(tenantMemberships).values({
            tenantId: invitationToHonor.tenantId,
            userId: userRow.id,
            role: invitationToHonor.role,
          });
          const [org] = await tx
            .select({ organizationId: tenants.organizationId })
            .from(tenants)
            .where(eq(tenants.id, invitationToHonor.tenantId))
            .limit(1);
          if (org?.organizationId) {
            await tx
              .insert(organizationMemberships)
              .values({
                organizationId: org.organizationId,
                userId: userRow.id,
                orgRole:
                  invitationToHonor.role === 'tenant_admin'
                    ? 'organization_admin'
                    : 'member',
                workspaceAccessMode: 'selected_workspaces',
              })
              .onConflictDoNothing();
          }
          await tx
            .update(tenantInvitations)
            .set({
              acceptedAt: new Date(),
              acceptedByUserId: userRow.id,
            })
            .where(eq(tenantInvitations.id, invitationToHonor.id));
          const [t] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, invitationToHonor.tenantId))
            .limit(1);
          if (!t) throw new Error('inviting tenant missing');
          return {
            user: userRow,
            tenant: t as typeof tenants.$inferSelect | null,
          };
        }

        if (grantToHonor) {
          // Grant-driven path: no personal tenant, no tenant memberships.
          // Claim the pending grant by filling in granted_to_user_id +
          // claimed_at. The user is a consumer — their home page is the
          // list of attestations granted to them.
          await tx
            .update(attestationAccessGrants)
            .set({
              grantedToUserId: userRow.id,
              claimedAt: new Date(),
            })
            .where(eq(attestationAccessGrants.id, grantToHonor.id));
          return { user: userRow, tenant: null };
        }

        return { user: userRow, tenant: null };
      });

      // Issue email verification token (LogNotificationProvider in dev).
      const { token, hash } = generateToken();
      await db.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: hash,
        expiresAt: minutesFromNow(config.emailVerificationTtlMinutes),
      });
      await notifications.sendEmailVerification({
        to: user.email,
        userId: user.id,
        token,
      });

      // Create the user's first session and set the cookie.
      const session = await createSession(db, {
        userId: user.id,
        ip: clientIp(req),
        userAgent: userAgent(req),
      });
      setSessionCookie(reply, session.id);

      await writeAuditEvent(db, {
        tenantId: tenant?.id ?? null,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.userRegistered,
        targetType: 'user',
        targetId: user.id,
      });
      await writeAuditEvent(db, {
        tenantId: tenant?.id ?? null,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.sessionCreated,
        targetType: 'session',
        targetId: session.id,
      });
      if (invitationToHonor) {
        await writeAuditEvent(db, {
          tenantId: invitationToHonor.tenantId,
          actorUserId: user.id,
          category: AUDIT_CATEGORIES.accessControl,
          action: AUDIT_ACTIONS.tenantInvitationAccepted,
          targetType: 'tenant_invitation',
          targetId: invitationToHonor.id,
          payload: { source: 'registration', role: invitationToHonor.role },
        });
        await writeAuditEvent(db, {
          tenantId: invitationToHonor.tenantId,
          actorUserId: user.id,
          category: AUDIT_CATEGORIES.basicAdmin,
          action: AUDIT_ACTIONS.tenantMemberAdded,
          targetType: 'user',
          targetId: user.id,
          payload: { source: 'registration', role: invitationToHonor.role },
        });
      }

      reply.code(201).send({
        user: publicUser(user),
        // Consumers (grant-driven) have no tenant — the verifier client interprets
        // a null tenant here as "go to the consumer landing".
        tenant: tenant
          ? { id: tenant.id, slug: tenant.slug, plan: tenant.plan }
          : null,
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/login
  // -----------------------------------------------------------------------
  app.post(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body as {
        email: string;
        password: string;
      };
      const normalizedEmail = normalizeEmail(email);

      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      const user = userRows[0];

      // Always run the hash check so the response time is stable regardless of
      // whether the email exists. argon2.verify on a constant hash is fine.
      const okPassword =
        user && !user.deactivatedAt
          ? await verifyPassword(user.passwordHash, password)
          : await verifyPassword(
              '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$3RnvgQDmd7l5d3pBQQiB1MnrYNRBhWoOd9SPbnNyqIQ',
              password,
            ).then(() => false);

      if (!user || !okPassword) {
        const auditWorkspace = user
          ? (await resolveWorkspaceChoices(user))[0] ?? null
          : null;
        await writeAuditEvent(db, {
          tenantId: auditWorkspace?.tenantId ?? null,
          actorUserId: user?.id ?? null,
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.loginFailed,
          payload: { email: normalizedEmail },
        });
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      const session = await createSession(db, {
        userId: user.id,
        ip: clientIp(req),
        userAgent: userAgent(req),
      });
      setSessionCookie(reply, session.id);
      const auditWorkspace = (await resolveWorkspaceChoices(user))[0] ?? null;

      await writeAuditEvent(db, {
        tenantId: auditWorkspace?.tenantId ?? null,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.loginSucceeded,
        targetType: 'session',
        targetId: session.id,
      });
      await writeAuditEvent(db, {
        tenantId: auditWorkspace?.tenantId ?? null,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.sessionCreated,
        targetType: 'session',
        targetId: session.id,
        payload: { source: 'password_login' },
      });

      reply.code(200).send({ user: publicUser(user) });
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/logout
  // -----------------------------------------------------------------------
  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies?.[config.sessionCookieName];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await revokeSession(db, unsigned.value);
        await writeAuditEvent(db, {
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.sessionRevoked,
          targetType: 'session',
          targetId: unsigned.value,
        });
      }
    }
    clearSessionCookie(reply);
    reply.code(204).send();
  });

  // -----------------------------------------------------------------------
  // GET /auth/me
  // -----------------------------------------------------------------------
  app.get(
    '/auth/me',
    {
      preHandler: requireSession,
    },
    async (req, _reply) => {
      // requireSession populates currentUser.
      const user = req.currentUser as User;
      const memberships = await resolveWorkspaceChoices(user);
      const organizationsById = new Map<
        string,
        {
          id: string;
          name: string;
          role: string;
          projectNoun: string;
          workspaceAccessMode: string;
        }
      >();
      for (const m of memberships) {
        if (!m.organizationId || !m.organizationName) continue;
        organizationsById.set(m.organizationId, {
          id: m.organizationId,
          name: m.organizationName,
          projectNoun: m.organizationProjectNoun ?? 'Project',
          role: m.organizationRole ?? 'member',
          workspaceAccessMode: m.workspaceAccessMode ?? 'selected_workspaces',
        });
      }
      return {
        user: publicUser(user),
        memberships: memberships.map((m) => ({
          tenantId: m.tenantId,
          slug: m.slug,
          plan: m.plan,
          name: m.name,
          projectNoun: m.organizationProjectNoun ?? m.projectNoun ?? 'Project',
          role: m.role,
          archivedAt: m.archivedAt?.toISOString() ?? null,
          organizationId: m.organizationId,
        })),
        organizations: [...organizationsById.values()],
        workspaces: memberships.map((m) => ({
          id: m.tenantId,
          slug: m.slug,
          name: m.name,
          plan: m.plan,
          projectNoun: m.organizationProjectNoun ?? m.projectNoun ?? 'Project',
          role: m.role,
          archivedAt: m.archivedAt?.toISOString() ?? null,
          organizationId: m.organizationId,
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/verify-email/send
  // -----------------------------------------------------------------------
  app.post(
    '/auth/verify-email/send',
    {
      preHandler: requireSession,
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      if (user.emailVerifiedAt) {
        return reply.code(204).send();
      }
      // Invalidate any prior unconsumed tokens for this user.
      await db
        .update(emailVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(emailVerificationTokens.userId, user.id),
            isNull(emailVerificationTokens.consumedAt),
          ),
        );
      const { token, hash } = generateToken();
      await db.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: hash,
        expiresAt: minutesFromNow(config.emailVerificationTtlMinutes),
      });
      await notifications.sendEmailVerification({
        to: user.email,
        userId: user.id,
        token,
      });
      await writeAuditEvent(db, {
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.userEmailVerificationRequested,
        targetType: 'user',
        targetId: user.id,
      });
      reply.code(202).send({ status: 'sent' });
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/verify-email/consume
  // -----------------------------------------------------------------------
  app.post(
    '/auth/verify-email/consume',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 10, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { token } = req.body as { token: string };
      const tokenHash = hashToken(token);
      const rows = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
        return reply.code(400).send({ error: 'invalid_or_expired_token' });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(emailVerificationTokens)
          .set({ consumedAt: new Date() })
          .where(eq(emailVerificationTokens.id, row.id));
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, row.userId));
      });
      await writeAuditEvent(db, {
        actorUserId: row.userId,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.userEmailVerified,
        targetType: 'user',
        targetId: row.userId,
      });
      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/password-reset/request
  // -----------------------------------------------------------------------
  app.post(
    '/auth/password-reset/request',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email } = req.body as { email: string };
      const normalizedEmail = normalizeEmail(email);
      const userRows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      const user = userRows[0];
      if (user) {
        await db
          .update(passwordResetTokens)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.userId, user.id),
              isNull(passwordResetTokens.consumedAt),
            ),
          );
        const { token, hash } = generateToken();
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: hash,
          expiresAt: minutesFromNow(config.passwordResetTtlMinutes),
        });
        await notifications.sendPasswordReset({
          to: user.email,
          userId: user.id,
          token,
        });
        await writeAuditEvent(db, {
          actorUserId: user.id,
          category: AUDIT_CATEGORIES.securitySensitiveAdmin,
          action: AUDIT_ACTIONS.passwordResetRequested,
          targetType: 'user',
          targetId: user.id,
        });
      }
      // Always 202 — no user enumeration via this endpoint.
      reply.code(202).send({ status: 'queued' });
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/password-reset/consume
  // -----------------------------------------------------------------------
  app.post(
    '/auth/password-reset/consume',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token', 'newPassword'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 10, maxLength: 200 },
            newPassword: { type: 'string', minLength: 8, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const { token, newPassword } = req.body as {
        token: string;
        newPassword: string;
      };
      const tokenHash = hashToken(token);
      const rows = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
        return reply.code(400).send({ error: 'invalid_or_expired_token' });
      }
      const passwordHash = await hashPassword(newPassword);
      await db.transaction(async (tx) => {
        await tx
          .update(passwordResetTokens)
          .set({ consumedAt: new Date() })
          .where(eq(passwordResetTokens.id, row.id));
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, row.userId));
        // Revoke all active sessions for this user (forces re-login everywhere).
        await tx
          .update(sessionsTable)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessionsTable.userId, row.userId),
              isNull(sessionsTable.revokedAt),
            ),
          );
      });
      await writeAuditEvent(db, {
        actorUserId: row.userId,
        category: AUDIT_CATEGORIES.securitySensitiveAdmin,
        action: AUDIT_ACTIONS.passwordResetCompleted,
        targetType: 'user',
        targetId: row.userId,
      });
      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/device/mint
  //
  // Sign-in-with-keypair-registration flow used by the fat-desktop app.
  // The client generates an Ed25519 keypair locally, sends email +
  // password + public key, the api validates the password and registers
  // the public key against an existing device row (none of the V1
  // pairing-code dance). Subsequent requests from the app are
  // device-signed; no session cookie is issued.
  //
  // For V1 the user must belong to exactly one tenant — multi-membership
  // users still need to use the legacy pairing flow until the
  // device-row-per-(user,machine) refactor lands (see docs/fat-desktop-pivot.md §4.4).
  // -----------------------------------------------------------------------
  app.post(
    '/auth/device/mint',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'publicKey', 'deviceName', 'platform'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 1024 },
            publicKey: { type: 'string', minLength: 32, maxLength: 200 },
            deviceName: { type: 'string', minLength: 1, maxLength: 200 },
            platform: { type: 'string', enum: ['darwin', 'win32'] },
            appVersion: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password, publicKey, deviceName, platform, appVersion } =
        req.body as {
          email: string;
          password: string;
          publicKey: string;
          deviceName: string;
          platform: 'darwin' | 'win32';
          appVersion?: string;
        };
      const normalizedEmail = normalizeEmail(email);

      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      const user = userRows[0];

      const okPassword =
        user && !user.deactivatedAt
          ? await verifyPassword(user.passwordHash, password)
          : await verifyPassword(
              '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$3RnvgQDmd7l5d3pBQQiB1MnrYNRBhWoOd9SPbnNyqIQ',
              password,
            ).then(() => false);
      if (!user || !okPassword) {
        await writeAuditEvent(db, {
          actorUserId: user?.id ?? null,
          category: AUDIT_CATEGORIES.identitySession,
          action: AUDIT_ACTIONS.loginFailed,
          payload: { email: normalizedEmail, source: 'device_mint' },
        });
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      const minted = await mintDesktopDevice({
        user,
        publicKey,
        deviceName,
        platform,
        appVersion,
      });
      if ('error' in minted) {
        return reply.code(403).send({ error: 'no_tenant_membership' });
      }
      reply.code(201).send(deviceMintResponse({ user, ...minted }));
    },
  );

  // -----------------------------------------------------------------------
  // POST /auth/device/mint-session
  //
  // Same desktop key registration as /auth/device/mint, but authenticated by
  // an existing web/session cookie. OIDC desktop sign-in uses this after the
  // browser callback mints a normal Proveria session.
  // -----------------------------------------------------------------------
  app.post(
    '/auth/device/mint-session',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['publicKey', 'deviceName', 'platform'],
          additionalProperties: false,
          properties: {
            publicKey: { type: 'string', minLength: 32, maxLength: 200 },
            deviceName: { type: 'string', minLength: 1, maxLength: 200 },
            platform: { type: 'string', enum: ['darwin', 'win32'] },
            appVersion: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const { publicKey, deviceName, platform, appVersion } = req.body as {
        publicKey: string;
        deviceName: string;
        platform: 'darwin' | 'win32';
        appVersion?: string;
      };
      const minted = await mintDesktopDevice({
        user,
        publicKey,
        deviceName,
        platform,
        appVersion,
      });
      if ('error' in minted) {
        return reply.code(403).send({ error: 'no_tenant_membership' });
      }
      reply.code(201).send(deviceMintResponse({ user, ...minted }));
    },
  );
};
