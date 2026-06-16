// Device-signed "self" routes for the desktop's Account view.
//
// The desktop authenticates with its Ed25519 device key, not a session
// cookie, so the existing /tenants/:slug/devices admin endpoints are
// unreachable from it. These mirror the bits of the device-management
// surface a producer actually needs from their own paired desktop:
//
//   GET  /me/devices              — list every device for this user
//                                    (across every tenant they belong to),
//                                    marking which one is the caller.
//   POST /me/devices/:id/revoke   — revoke a device the caller owns.
//                                    Self-revoke is allowed but warned in UI.
//   GET  /me/attestations/recent  — recent attestations created by THIS
//                                    device, newest-first.

import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import {
  attestations,
  devices,
  externalIdentities,
  oidcAuthStates,
  oidcIdentityProviders,
  organizationMemberships,
  organizations,
  projects,
  tenantMemberships,
  tenants,
  verificationLinks,
  type DrizzleClient,
  type Role,
  type User,
} from '@proveria/db';

import { writeAuditEvent } from '../audit/writer.js';
import {
  buildAuthorizationUrl,
  findEnabledOidcProvider,
  publicOidcProvider,
  randomBase64Url,
  sha256Base64Url,
  sha256Hex,
} from '../auth/oidc.js';
import { requireDeviceSignatureFactory } from '../auth/device-signature.js';
import { config } from '../config.js';

export interface MePluginOptions {
  db: DrizzleClient;
}

export const mePlugin: FastifyPluginAsync<MePluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;
  const requireDeviceSignature = requireDeviceSignatureFactory(db);

  const minutesFromNow = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000);

  const workspaceRoleForOrganizationRole = (role: string | null): Role =>
    role === 'organization_admin' ? 'tenant_admin' : 'producer';

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

  const resolveWorkspaceChoices = async (user: User) => {
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

    const choices = new Map<string, (typeof explicitRows)[number]>();
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
      choices.set(row.tenantId, row);
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
        organizationRevokedAt: null,
      });
    }

    return [...choices.values()];
  };

  // -----------------------------------------------------------------------
  // GET /me/session  (device-signed)
  //
  // Desktop session refresh for paired devices. This mirrors the workspace
  // summary returned by /auth/me, but authenticates with the local device key.
  // -----------------------------------------------------------------------
  app.get(
    '/me/session',
    { preHandler: requireDeviceSignature },
    async (req) => {
      const meUser = req.currentDeviceUser!;
      const memberships = await resolveWorkspaceChoices(meUser);
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
        user: publicUser(meUser),
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
  // GET /me/external-identities/:provider/connect/start  (device-signed)
  //
  // Starts a provider connection flow tied to the current Proveria user.
  // The callback may link an email that differs from the Proveria account
  // email, but it cannot create or switch to a different Proveria user.
  // -----------------------------------------------------------------------
  app.get<{ Params: { provider: string } }>(
    '/me/external-identities/:provider/connect/start',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const meUser = req.currentDeviceUser!;
      const provider = await findEnabledOidcProvider(db, req.params.provider);
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
        flow: 'connect',
        connectUserId: meUser.id,
        redirectTo: '/',
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

  // -----------------------------------------------------------------------
  // GET /me/external-identities  (device-signed)
  //
  // Linked OIDC identities for the caller's user. Secrets and raw claims stay
  // server-side; Profile only needs provider/email/link timestamps.
  // -----------------------------------------------------------------------
  app.get(
    '/me/external-identities',
    { preHandler: requireDeviceSignature },
    async (req) => {
      const meUser = req.currentDeviceUser!;
      const rows = await db
        .select({
          id: externalIdentities.id,
          providerSlug: oidcIdentityProviders.slug,
          providerDisplayName: oidcIdentityProviders.displayName,
          email: externalIdentities.email,
          emailVerified: externalIdentities.emailVerified,
          linkedAt: externalIdentities.linkedAt,
          lastSeenAt: externalIdentities.lastSeenAt,
          disconnectedAt: externalIdentities.disconnectedAt,
        })
        .from(externalIdentities)
        .innerJoin(
          oidcIdentityProviders,
          eq(oidcIdentityProviders.id, externalIdentities.providerId),
        )
        .where(eq(externalIdentities.userId, meUser.id))
        .orderBy(desc(externalIdentities.linkedAt));
      return {
        identities: rows.map((identity) => ({
          id: identity.id,
          providerSlug: identity.providerSlug,
          providerDisplayName: identity.providerDisplayName,
          email: identity.email,
          emailVerified: identity.emailVerified,
          linkedAt: identity.linkedAt.toISOString(),
          lastSeenAt: identity.lastSeenAt
            ? identity.lastSeenAt.toISOString()
            : null,
          disconnectedAt: identity.disconnectedAt
            ? identity.disconnectedAt.toISOString()
            : null,
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /me/external-identities/:id/disconnect  (device-signed)
  //
  // Conservative first pass: do not allow removing the final linked external
  // identity. We can loosen this once explicit password setup/recovery exists.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/me/external-identities/:id/disconnect',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const me = req.currentDevice!;
      const meUser = req.currentDeviceUser!;
      const rows = await db
        .select({
          identity: externalIdentities,
          providerSlug: oidcIdentityProviders.slug,
          providerDisplayName: oidcIdentityProviders.displayName,
        })
        .from(externalIdentities)
        .innerJoin(
          oidcIdentityProviders,
          eq(oidcIdentityProviders.id, externalIdentities.providerId),
        )
        .where(
          and(
            eq(externalIdentities.id, req.params.id),
            eq(externalIdentities.userId, meUser.id),
          ),
        )
        .limit(1);
      const target = rows[0];
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (target.identity.disconnectedAt) {
        return reply.code(409).send({ error: 'already_disconnected' });
      }

      const activeRows = await db
        .select({ id: externalIdentities.id })
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.userId, meUser.id),
            isNull(externalIdentities.disconnectedAt),
          ),
        );
      if (activeRows.length <= 1) {
        return reply.code(409).send({ error: 'last_external_identity' });
      }

      await db
        .update(externalIdentities)
        .set({ disconnectedAt: new Date() })
        .where(eq(externalIdentities.id, target.identity.id));

      await writeAuditEvent(db, {
        tenantId: me.tenantId,
        actorUserId: meUser.id,
        actorDeviceId: me.id,
        category: AUDIT_CATEGORIES.identitySession,
        action: AUDIT_ACTIONS.externalIdentityDisconnected,
        targetType: 'external_identity',
        targetId: target.identity.id,
        payload: {
          provider: target.providerSlug,
          providerDisplayName: target.providerDisplayName,
          email: target.identity.email,
        },
      });

      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // GET /me/devices  (device-signed)
  //
  // Every device for the caller's user across every tenant they belong to.
  // `isCurrent: true` on the row matching the calling device so the
  // desktop can highlight + warn before self-revoking.
  // -----------------------------------------------------------------------
  app.get(
    '/me/devices',
    { preHandler: requireDeviceSignature },
    async (req) => {
      const me = req.currentDevice!;
      const meUser = req.currentDeviceUser!;
      const rows = await db
        .select({
          id: devices.id,
          tenantId: devices.tenantId,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          profileId: devices.profileId,
          name: devices.name,
          platform: devices.platform,
          appVersion: devices.appVersion,
          pairedAt: devices.pairedAt,
          lastSeenAt: devices.lastSeenAt,
          revokedAt: devices.revokedAt,
        })
        .from(devices)
        .innerJoin(tenants, eq(tenants.id, devices.tenantId))
        .where(eq(devices.userId, meUser.id))
        .orderBy(desc(devices.pairedAt));
      return {
        devices: rows.map((d) => ({
          id: d.id,
          isCurrent: d.id === me.id,
          tenantId: d.tenantId,
          tenantSlug: d.tenantSlug,
          tenantName: d.tenantName,
          profileId: d.profileId,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          pairedAt: d.pairedAt.toISOString(),
          lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
          revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /me/devices/:id/revoke  (device-signed)
  //
  // The caller can revoke any device that belongs to the same user. Once
  // revoked, the device-signature middleware rejects every subsequent
  // request from that device with 401. Audit-logged against the tenant
  // the revoked device was paired to.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/me/devices/:id/revoke',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const me = req.currentDevice!;
      const meUser = req.currentDeviceUser!;
      const rows = await db
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.id, req.params.id),
            eq(devices.userId, meUser.id),
          ),
        )
        .limit(1);
      const target = rows[0];
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (target.revokedAt) {
        return reply.code(409).send({ error: 'already_revoked' });
      }

      await db
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(eq(devices.id, target.id));

      await writeAuditEvent(db, {
        tenantId: target.tenantId,
        actorUserId: meUser.id,
        actorDeviceId: me.id,
        category: AUDIT_CATEGORIES.devicePairing,
        action: AUDIT_ACTIONS.deviceRevoked,
        targetType: 'device',
        targetId: target.id,
        payload: { selfRevoke: target.id === me.id },
      });

      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // GET /me/attestations/recent  (device-signed)
  //
  // Recent attestations CREATED BY THIS DEVICE, newest-first. Limited to
  // the device's tenant + the producer's own actions — they don't see
  // attestations from sibling devices on the same tenant here.
  // -----------------------------------------------------------------------
  app.get<{ Querystring: { limit?: string } }>(
    '/me/attestations/recent',
    { preHandler: requireDeviceSignature },
    async (req) => {
      const me = req.currentDevice!;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
      const rows = await db
        .select({
          id: attestations.id,
          label: attestations.label,
          description: attestations.description,
          state: attestations.state,
          createdAt: attestations.createdAt,
          confirmedAt: attestations.confirmedAt,
          failedAt: attestations.failedAt,
          projectSlug: projects.slug,
          projectName: projects.name,
        })
        .from(attestations)
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .where(eq(attestations.createdByDeviceId, me.id))
        .orderBy(desc(attestations.createdAt))
        .limit(limit);
      const receiptLinkRows =
        rows.length > 0
          ? await db
              .select({
                id: verificationLinks.id,
                targetRef: verificationLinks.targetRef,
              })
              .from(verificationLinks)
              .where(
                and(
                  eq(verificationLinks.targetType, 'receipt'),
                  inArray(
                    verificationLinks.targetRef,
                    rows.map((row) => row.id),
                  ),
                  isNull(verificationLinks.revokedAt),
                ),
              )
          : [];
      const receiptLinkByAttestationId = new Map(
        receiptLinkRows.map((link) => [link.targetRef, link.id]),
      );
      return {
        attestations: rows.map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          state: a.state,
          projectSlug: a.projectSlug,
          projectName: a.projectName,
          createdAt: a.createdAt.toISOString(),
          confirmedAt: a.confirmedAt ? a.confirmedAt.toISOString() : null,
          failedAt: a.failedAt ? a.failedAt.toISOString() : null,
          verificationLinkId: receiptLinkByAttestationId.get(a.id) ?? null,
        })),
      };
    },
  );
};
