// Integration tests for /tenants/* and /invitations/accept.
// Same pattern as auth/routes.test.ts — real Postgres, truncate between tests.

import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createClient, type ClientHandle } from '@proveria/db';

import { asc, eq } from 'drizzle-orm';
import {
  auditCheckpoints,
  auditEventHashChain,
  auditEvents,
} from '@proveria/db';
import {
  CHAIN_GENESIS_HEX,
  computeChainHash,
} from '@proveria/audit';
import {
  computeMerkleRoot,
  generateEd25519Keypair,
  signEd25519,
} from '@proveria/crypto-core';

import { buildDeviceSignatureHeaders } from '../auth/device-signature.js';
import { authPlugin } from '../auth/routes.js';
import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { projectPlugin } from '../projects/routes.js';
import { tenantPlugin } from './routes.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;
let notificationLines: string[];
const storedBytes = new Map<string, Buffer>();
const evidenceExportJobs: Array<{ jobId: string }> = [];
const deletedObjectKeys: string[] = [];

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_events,
      public.export_jobs,
      public.verification_links,
      public.verification_results,
      public.submission_attempts,
      public.attestations,
      public.projects,
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
  if (!match) throw new Error(`no token in: ${line}`);
  return match[1] ?? '';
};

const extractCookies = (response: {
  headers: { 'set-cookie'?: string | string[] };
}): string => {
  const raw = response.headers['set-cookie'];
  if (!raw) throw new Error('expected Set-Cookie');
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c))
    .join('; ');
};

interface RegistrationResult {
  cookies: string;
  user: { id: string; email: string };
  tenant: { id: string; slug: string };
}

// Bump a freshly-registered tenant to team_pro so invitations don't trip
// the M13/C50 user-count cap (Free is capped at 1).
const upgradeToTeamPro = async (tenantId: string): Promise<void> => {
  await dbHandle.sql`
    UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${tenantId}`;
};

const register = async (
  email: string,
  password: string,
): Promise<RegistrationResult> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register ${email} failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as {
    user: { id: string; email: string };
    tenant: null;
  };
  const workspace = await app.inject({
    method: 'POST',
    url: '/tenants',
    headers: { cookie: extractCookies(res) },
    payload: { name: email },
  });
  if (workspace.statusCode !== 201) {
    throw new Error(
      `workspace ${email} failed: ${workspace.statusCode} ${workspace.body}`,
    );
  }
  const workspaceBody = workspace.json() as {
    tenant: { id: string; slug: string };
  };
  return {
    cookies: extractCookies(res),
    user: body.user,
    tenant: workspaceBody.tenant,
  };
};

const inviteAndAccept = async (
  owner: RegistrationResult,
  email: string,
  role: 'tenant_admin' | 'producer' | 'consumer' = 'producer',
): Promise<RegistrationResult> => {
  notificationLines.length = 0;
  const invite = await app.inject({
    method: 'POST',
    url: `/tenants/${owner.tenant.slug}/invitations`,
    headers: { cookie: owner.cookies },
    payload: { email, role },
  });
  if (invite.statusCode !== 201) {
    throw new Error(
      `invite ${email} failed: ${invite.statusCode} ${invite.body}`,
    );
  }
  const token = extractToken(notificationLines[0] ?? '');
  const invitee = await register(email, 'password123');
  const accept = await app.inject({
    method: 'POST',
    url: '/invitations/accept',
    headers: { cookie: invitee.cookies },
    payload: { token },
  });
  if (accept.statusCode !== 200) {
    throw new Error(
      `accept ${email} failed: ${accept.statusCode} ${accept.body}`,
    );
  }
  return invitee;
};

interface DesktopDevice {
  deviceId: string;
  privateKey: string;
}

const mintDesktopDevice = async (
  email: string,
  password: string,
): Promise<DesktopDevice> => {
  const kp = await generateEd25519Keypair();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/device/mint',
    payload: {
      email,
      password,
      publicKey: kp.publicKey,
      deviceName: 'Desktop Test',
      platform: 'darwin',
      appVersion: '0.0.0',
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`device mint failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { device: { id: string } };
  return { deviceId: body.device.id, privateKey: kp.privateKey };
};

const signedDesktopRequest = async (
  device: DesktopDevice,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
): Promise<{
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  payload?: Record<string, unknown>;
}> => {
  const bodyBytes = body
    ? new TextEncoder().encode(JSON.stringify(body))
    : new Uint8Array(0);
  const headers = await buildDeviceSignatureHeaders(
    (payload) => signEd25519(payload, device.privateKey),
    device.deviceId,
    method,
    url,
    bodyBytes,
  );
  return body
    ? {
        method,
        url,
        headers: { 'content-type': 'application/json', ...headers },
        payload: body,
      }
    : { method, url, headers };
};

beforeAll(async () => {
  dbHandle = createClient({ url: DATABASE_URL, max: 5 });
  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(cookie, { secret: config.sessionSecret });
  notificationLines = [];
  const notifications = new LogNotificationProvider((line) =>
    notificationLines.push(line),
  );
  await app.register(authPlugin, { db: dbHandle.db, notifications });
  await app.register(tenantPlugin, {
    db: dbHandle.db,
    notifications,
    getObjectBytes: async (key) => storedBytes.get(key) ?? null,
    deleteObject: async (key) => {
      deletedObjectKeys.push(key);
      storedBytes.delete(key);
    },
    enqueueEvidenceExport: async (job) => {
      evidenceExportJobs.push({ jobId: job.jobId });
    },
  });
  await app.register(projectPlugin, { db: dbHandle.db });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  notificationLines.length = 0;
  storedBytes.clear();
  evidenceExportJobs.length = 0;
  deletedObjectKeys.length = 0;
  await truncateAll();
});

// ---------------------------------------------------------------------------
// POST /tenants
// ---------------------------------------------------------------------------

describe('POST /tenants', () => {
  it('creates the first workspace explicitly for a self-registered user', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'founder@example.com', password: 'password123' },
    });
    expect(reg.statusCode).toBe(201);
    expect((reg.json() as { tenant: null }).tenant).toBeNull();

    const res = await app.inject({
      method: 'POST',
      url: '/tenants',
      headers: { cookie: extractCookies(reg) },
      payload: { name: 'Acme Records' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      tenant: { slug: string; name: string; plan: string; isPersonal: boolean };
    };
    expect(body.tenant.name).toBe('Acme Records');
    expect(body.tenant.slug).toBe('acme-records');
    expect(body.tenant.plan).toBe('free');
    expect(body.tenant.isPersonal).toBe(false);
    const orgRows = await dbHandle.sql<
      { organization_id: string; org_name: string; org_role: string }[]
    >`
      SELECT
        t.organization_id,
        o.name AS org_name,
        om.org_role
      FROM public.tenants t
      INNER JOIN public.organizations o ON o.id = t.organization_id
      INNER JOIN public.organization_memberships om
        ON om.organization_id = o.id
      WHERE t.slug = 'acme-records'`;
    expect(orgRows).toEqual([
      {
        organization_id: orgRows[0]!.organization_id,
        org_name: 'Acme Records',
        org_role: 'organization_admin',
      },
    ]);
  });

  it('rejects a second workspace for the same V1 user', async () => {
    const owner = await register('owner@example.com', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/tenants',
      headers: { cookie: owner.cookies },
      payload: { name: 'Second Workspace' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe(
      'workspace_already_exists',
    );
  });
});

// ---------------------------------------------------------------------------
// GET /tenants/:slug
// ---------------------------------------------------------------------------

describe('GET /tenants/:slug', () => {
  it('returns the tenant and the caller membership for a member', async () => {
    const owner = await register('owner@example.com', 'password123');
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tenant: { slug: string; plan: string };
      membership: { role: string };
    };
    expect(body.tenant.slug).toBe(owner.tenant.slug);
    expect(body.tenant.plan).toBe('free');
    expect(body.membership.role).toBe('tenant_admin');
  });

  it('returns 404 for a non-member (no enumeration)', async () => {
    const owner = await register('owner@example.com', 'password123');
    const stranger = await register('stranger@example.com', 'password123');
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}`,
      headers: { cookie: stranger.cookies },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when organization access mode is none', async () => {
    const owner = await register('owner@example.com', 'password123');
    await dbHandle.sql`
      UPDATE public.organization_memberships
      SET workspace_access_mode = 'none', revoked_at = now()
      FROM public.tenants
      WHERE organization_memberships.organization_id = tenants.organization_id
        AND tenants.id = ${owner.tenant.id}
        AND organization_memberships.user_id = ${owner.user.id}`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(404);
  });

  it('allows all-workspace organization members without explicit workspace membership', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'org-member@example.com', password: 'password123' },
    });
    const cookies = extractCookies(reg);
    const [user] = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'org-member@example.com' LIMIT 1`;
    const [organization] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.organizations (name)
      VALUES ('All Workspace Org')
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      VALUES (${organization!.id}, 'Shared Workspace', 'shared-workspace', 'team_pro', false)`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      VALUES (${organization!.id}, ${user!.id}, 'member', 'all_workspaces')`;

    const res = await app.inject({
      method: 'GET',
      url: '/tenants/shared-workspace',
      headers: { cookie: cookies },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { membership: { role: string } }).membership.role).toBe(
      'producer',
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants/whatever' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /tenants/:slug/members
// ---------------------------------------------------------------------------

describe('GET /tenants/:slug/members', () => {
  it('admin sees own membership', async () => {
    const owner = await register('owner@example.com', 'password123');
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/members`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      members: { email: string; role: string }[];
    };
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.role).toBe('tenant_admin');
    expect(body.members[0]?.email).toBe('owner@example.com');
  });

  it('desktop device signature can manage members and invitations', async () => {
    const owner = await register('desktop-admin@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const device = await mintDesktopDevice(
      'desktop-admin@example.com',
      'password123',
    );

    const members = await app.inject(
      await signedDesktopRequest(
        device,
        'GET',
        `/tenants/${owner.tenant.slug}/members`,
      ),
    );
    expect(members.statusCode).toBe(200);
    expect(
      (members.json() as { members: { email: string }[] }).members[0]?.email,
    ).toBe('desktop-admin@example.com');

    const create = await app.inject(
      await signedDesktopRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/invitations`,
        { email: 'desktop-producer@example.com', role: 'producer' },
      ),
    );
    expect(create.statusCode).toBe(201);
    const invitationId = (create.json() as { invitation: { id: string } })
      .invitation.id;

    const invitations = await app.inject(
      await signedDesktopRequest(
        device,
        'GET',
        `/tenants/${owner.tenant.slug}/invitations`,
      ),
    );
    expect(invitations.statusCode).toBe(200);
    expect(
      (invitations.json() as { invitations: { email: string }[] }).invitations
        .map((invitation) => invitation.email),
    ).toContain('desktop-producer@example.com');

    const revoke = await app.inject(
      await signedDesktopRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/invitations/${invitationId}/revoke`,
        {},
      ),
    );
    expect(revoke.statusCode).toBe(204);
  });

  it('admin sees organization users after creating and switching to a new workspace', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    await inviteAndAccept(owner, 'producer@example.com', 'producer');

    const createWorkspace = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Research Workspace' },
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspace = (createWorkspace.json() as {
      tenant: { slug: string };
    }).tenant;

    const members = await app.inject({
      method: 'GET',
      url: `/tenants/${workspace.slug}/members`,
      headers: { cookie: owner.cookies },
    });
    expect(members.statusCode).toBe(200);
    const body = members.json() as {
      members: Array<{
        email: string;
        workspaces: Array<{ name: string; slug: string }>;
      }>;
    };
    expect(body.members.map((member) => member.email).sort()).toEqual([
      'owner@example.com',
      'producer@example.com',
    ]);
    expect(
      body.members.find((member) => member.email === 'owner@example.com')
        ?.workspaces,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Research Workspace' }),
      ]),
    );
    expect(
      body.members.find((member) => member.email === 'producer@example.com')
        ?.workspaces,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: owner.tenant.slug }),
      ]),
    );
  });

  it('organization admin archives and restores another workspace', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const createWorkspace = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Archive Target' },
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspace = (createWorkspace.json() as {
      tenant: { id: string; archivedAt: string | null };
    }).tenant;
    expect(workspace.archivedAt).toBeNull();

    const archive = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces/${workspace.id}/archive`,
      headers: { cookie: owner.cookies },
    });
    expect(archive.statusCode).toBe(200);
    expect(
      (archive.json() as { tenant: { archivedAt: string | null } }).tenant
        .archivedAt,
    ).not.toBeNull();

    const archiveActive = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces/${owner.tenant.id}/archive`,
      headers: { cookie: owner.cookies },
    });
    expect(archiveActive.statusCode).toBe(409);

    const restore = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces/${workspace.id}/restore`,
      headers: { cookie: owner.cookies },
    });
    expect(restore.statusCode).toBe(200);
    expect(
      (restore.json() as { tenant: { archivedAt: string | null } }).tenant
        .archivedAt,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// invitation flow: create → list → accept
// ---------------------------------------------------------------------------

describe('invitation flow', () => {
  it('admin invites a teammate, who registers + accepts and becomes a producer', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0; // drop the email-verification line

    const create = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'producer@example.com', role: 'producer' },
    });
    expect(create.statusCode).toBe(201);
    expect(notificationLines).toHaveLength(1);
    expect(notificationLines[0]).toContain('tenant_invitation');
    expect(notificationLines[0]).toContain('role=producer');
    const token = extractToken(notificationLines[0] ?? '');

    // List shows the active invitation.
    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
    });
    const listBody = list.json() as { invitations: { email: string }[] };
    expect(listBody.invitations).toHaveLength(1);
    expect(listBody.invitations[0]?.email).toBe('producer@example.com');

    // Invitee registers with the matching email.
    const invitee = await register('producer@example.com', 'password123');

    // Accept the invitation while logged in as the invitee.
    const accept = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token },
    });
    expect(accept.statusCode).toBe(200);
    const acceptBody = accept.json() as {
      tenant: { slug: string };
      membership: { role: string };
    };
    expect(acceptBody.tenant.slug).toBe(owner.tenant.slug);
    expect(acceptBody.membership.role).toBe('producer');

    // Members list now shows both.
    const members = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/members`,
      headers: { cookie: owner.cookies },
    });
    const m = members.json() as { members: { email: string; role: string }[] };
    expect(m.members).toHaveLength(2);
    const producer = m.members.find((x) => x.role === 'producer');
    expect(producer?.email).toBe('producer@example.com');
    const orgMemberships = await dbHandle.sql<
      { workspace_access_mode: string; org_role: string }[]
    >`
      SELECT om.workspace_access_mode, om.org_role
      FROM public.organization_memberships om
      INNER JOIN public.users u ON u.id = om.user_id
      INNER JOIN public.tenants t ON t.organization_id = om.organization_id
      WHERE u.email = 'producer@example.com'
        AND t.id = ${owner.tenant.id}`;
    expect(orgMemberships).toEqual([
      { workspace_access_mode: 'selected_workspaces', org_role: 'member' },
    ]);

    // Active-invitations list is now empty.
    const list2 = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
    });
    expect((list2.json() as { invitations: unknown[] }).invitations).toHaveLength(0);

    const auditRows = await dbHandle.sql<{ action: string; tenant_id: string }[]>`
      SELECT action, tenant_id
      FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
      ORDER BY created_at`;
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'tenant_invitation.created',
        'tenant_invitation.accepted',
        'tenant_member.added',
      ]),
    );
    expect(
      auditRows.filter((row) =>
        [
          'tenant_invitation.created',
          'tenant_invitation.accepted',
          'tenant_member.added',
        ].includes(row.action),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenant_id: owner.tenant.id }),
      ]),
    );
  });

  it('audits the prior invite when replacing an active invitation', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;

    const first = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'producer@example.com', role: 'producer' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'producer@example.com', role: 'producer' },
    });
    expect(second.statusCode).toBe(201);

    const active = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
    });
    expect((active.json() as { invitations: unknown[] }).invitations).toHaveLength(1);

    const auditRows = await dbHandle.sql<
      { action: string; payload: { reason?: string } }[]
    >`
      SELECT action, payload
      FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
        AND action IN ('tenant_invitation.created', 'tenant_invitation.revoked')
      ORDER BY created_at`;
    expect(auditRows.map((row) => row.action)).toEqual([
      'tenant_invitation.created',
      'tenant_invitation.revoked',
      'tenant_invitation.created',
    ]);
    expect(auditRows[1]?.payload).toEqual(
      expect.objectContaining({ reason: 'replaced_by_new_invitation' }),
    );
  });

  it('rejects accept when the authenticated email does not match invitation', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'wanted@example.com', role: 'producer' },
    });
    const token = extractToken(notificationLines[0] ?? '');

    const wrong = await register('wrong@example.com', 'password123');
    const accept = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: wrong.cookies },
      payload: { token },
    });
    expect(accept.statusCode).toBe(403);
  });

  it('non-admin cannot create invitations (403)', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'producer@example.com', role: 'producer' },
    });
    const token = extractToken(notificationLines[0] ?? '');

    const invitee = await register('producer@example.com', 'password123');
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token },
    });

    // Producer tries to invite — should fail with 403.
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: invitee.cookies },
      payload: { email: 'somebody@example.com', role: 'consumer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects invitation when invitee is already a member (409)', async () => {
    const owner = await register('owner@example.com', 'password123');
    const create = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'owner@example.com', role: 'producer' },
    });
    expect(create.statusCode).toBe(409);
  });

  it('revoking an invitation prevents its acceptance', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;
    const create = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'pending@example.com', role: 'producer' },
    });
    const invId = (create.json() as { invitation: { id: string } }).invitation.id;
    const token = extractToken(notificationLines[0] ?? '');

    const revoke = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations/${invId}/revoke`,
      headers: { cookie: owner.cookies },
    });
    expect(revoke.statusCode).toBe(204);

    const invitee = await register('pending@example.com', 'password123');
    const accept = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token },
    });
    expect(accept.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------
  // M13/C50 — user cap rejects invitations once tenant is at plan max
  // -------------------------------------------------------------------
  it('Free tenant (cap 1) cannot invite a second user (409)', async () => {
    const owner = await register('owner@example.com', 'password123');
    notificationLines.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'second@example.com', role: 'producer' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: string;
      limit: number;
      current: number;
    };
    expect(body.error).toBe('user_count_limit_reached');
    expect(body.limit).toBe(1);
    expect(body.current).toBe(1);
  });

  it('issuing a new invitation for the same email revokes the prior one', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'invitee@example.com', role: 'producer' },
    });
    const firstToken = extractToken(notificationLines[0] ?? '');

    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'invitee@example.com', role: 'consumer' },
    });
    const secondToken = extractToken(notificationLines[0] ?? '');
    expect(secondToken).not.toBe(firstToken);

    const invitee = await register('invitee@example.com', 'password123');
    const firstAttempt = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token: firstToken },
    });
    expect(firstAttempt.statusCode).toBe(400);

    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token: secondToken },
    });
    expect(secondAttempt.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /tenants/:slug/members/:userId/access
// ---------------------------------------------------------------------------

describe('PATCH /tenants/:slug/members/:userId/access', () => {
  it('organization admin updates the global project language for all workspaces', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);

    const settings = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/organization/settings`,
      headers: { cookie: owner.cookies },
      payload: { projectNoun: 'Case' },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      organization: { projectNoun: 'Case' },
      tenant: { id: owner.tenant.id, projectNoun: 'Case' },
    });

    const createWorkspace = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Litigation Workspace' },
    });
    expect(createWorkspace.statusCode).toBe(201);
    expect(createWorkspace.json()).toMatchObject({
      tenant: { projectNoun: 'Case' },
    });
  });

  it('admin changes workspace access and role for a member', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/members/${producer.user.id}/access`,
      headers: { cookie: owner.cookies },
      payload: {
        role: 'tenant_admin',
        organizationRole: 'organization_admin',
        workspaceAccessMode: 'all_workspaces',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      member: {
        userId: producer.user.id,
        role: 'tenant_admin',
        organizationRole: 'organization_admin',
        workspaceAccessMode: 'all_workspaces',
        revoked: false,
      },
    });

    const members = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/members`,
      headers: { cookie: owner.cookies },
    });
    const body = members.json() as {
      members: Array<{
        email: string;
        role: string;
        organizationRole: string;
        workspaceAccessMode: string;
      }>;
    };
    expect(
      body.members.find((member) => member.email === 'producer@example.com'),
    ).toMatchObject({
      role: 'tenant_admin',
      organizationRole: 'organization_admin',
      workspaceAccessMode: 'all_workspaces',
    });

    const events = await dbHandle.sql<{ action: string; payload: unknown }[]>`
      SELECT action, payload
      FROM audit.audit_events
      WHERE target_id = ${producer.user.id}
      ORDER BY created_at DESC
      LIMIT 1`;
    expect(events[0]?.action).toBe('tenant_member.access_changed');
  });

  it('admin can add an existing member to another workspace', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );
    const createWorkspace = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Research Workspace' },
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspace = (createWorkspace.json() as {
      tenant: { id: string; slug: string };
    }).tenant;

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/members/${producer.user.id}/access`,
      headers: { cookie: owner.cookies },
      payload: {
        role: 'producer',
        organizationRole: 'member',
        workspaceAccessMode: 'selected_workspaces',
        workspaceIds: [owner.tenant.id, workspace.id],
      },
    });
    expect(res.statusCode).toBe(200);

    const members = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/members`,
      headers: { cookie: owner.cookies },
    });
    expect(members.statusCode).toBe(200);
    const body = members.json() as {
      members: Array<{
        email: string;
        workspaces: Array<{ id: string; slug: string }>;
      }>;
    };
    expect(
      body.members.find((member) => member.email === 'producer@example.com')
        ?.workspaces,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: owner.tenant.id }),
        expect.objectContaining({ id: workspace.id }),
      ]),
    );
  });

  it('admin can revoke a member from the current workspace', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/members/${producer.user.id}/access`,
      headers: { cookie: owner.cookies },
      payload: { workspaceAccessMode: 'none' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      member: {
        userId: producer.user.id,
        role: null,
        organizationRole: 'member',
        workspaceAccessMode: 'none',
        revoked: true,
      },
    });

    const probe = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}`,
      headers: { cookie: producer.cookies },
    });
    expect(probe.statusCode).toBe(404);

    const orgMemberships = await dbHandle.sql<
      { workspace_access_mode: string; revoked_at: Date | null }[]
    >`
      SELECT om.workspace_access_mode, om.revoked_at
      FROM public.organization_memberships om
      INNER JOIN public.tenants t ON t.organization_id = om.organization_id
      WHERE om.user_id = ${producer.user.id}
        AND t.id = ${owner.tenant.id}`;
    expect(orgMemberships).toHaveLength(1);
    expect(orgMemberships[0]?.workspace_access_mode).toBe('none');
    expect(orgMemberships[0]?.revoked_at).toBeTruthy();
  });

  it('refuses access changes that remove the current admin', async () => {
    const owner = await register('owner@example.com', 'password123');

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/members/${owner.user.id}/access`,
      headers: { cookie: owner.cookies },
      payload: { workspaceAccessMode: 'none' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('cannot_remove_self');
  });

  it('refuses access changes that remove the last organization admin', async () => {
    const owner = await register('owner@example.com', 'password123');

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/members/${owner.user.id}/access`,
      headers: { cookie: owner.cookies },
      payload: {
        role: 'tenant_admin',
        organizationRole: 'member',
        workspaceAccessMode: 'selected_workspaces',
        workspaceIds: [owner.tenant.id],
      },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe(
      'cannot_remove_last_organization_admin',
    );
  });

  it('non-admin cannot change member access', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenants/${owner.tenant.slug}/members/${owner.user.id}/access`,
      headers: { cookie: producer.cookies },
      payload: { role: 'producer' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /tenants/:slug/members/:userId
// ---------------------------------------------------------------------------

describe('DELETE /tenants/:slug/members/:userId', () => {
  it('admin can remove a non-admin member', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'producer@example.com', role: 'producer' },
    });
    const token = extractToken(notificationLines[0] ?? '');
    const invitee = await register('producer@example.com', 'password123');
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/tenants/${owner.tenant.slug}/members/${invitee.user.id}`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(204);

    // Invitee no longer sees the tenant.
    const probe = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}`,
      headers: { cookie: invitee.cookies },
    });
    expect(probe.statusCode).toBe(404);
  });

  it('refuses to remove the current user (409)', async () => {
    const owner = await register('owner@example.com', 'password123');
    const res = await app.inject({
      method: 'DELETE',
      url: `/tenants/${owner.tenant.slug}/members/${owner.user.id}`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string };
    expect(body.error).toBe('cannot_remove_self');
  });

  it('refuses to remove the last remaining admin through another admin', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'admin2@example.com', role: 'tenant_admin' },
    });
    const token = extractToken(notificationLines[0] ?? '');
    const admin2 = await register('admin2@example.com', 'password123');
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: admin2.cookies },
      payload: { token },
    });

    const removeOwner = await app.inject({
      method: 'DELETE',
      url: `/tenants/${owner.tenant.slug}/members/${owner.user.id}`,
      headers: { cookie: admin2.cookies },
    });
    expect(removeOwner.statusCode).toBe(204);

    const removeAdmin2 = await app.inject({
      method: 'DELETE',
      url: `/tenants/${owner.tenant.slug}/members/${admin2.user.id}`,
      headers: { cookie: admin2.cookies },
    });
    expect(removeAdmin2.statusCode).toBe(409);
    expect((removeAdmin2.json() as { error: string }).error).toBe(
      'cannot_remove_self',
    );
  });
});

describe('GET /tenants/:slug/audit', () => {
  // Invite + accept a teammate at the given role, returning their cookies.
  const addTeammate = async (
    owner: RegistrationResult,
    email: string,
    role: 'producer' | 'consumer',
  ): Promise<string> => {
    notificationLines.length = 0;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email, role },
    });
    const token = extractToken(notificationLines[0] ?? '');
    const invitee = await register(email, 'password123');
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token },
    });
    return invitee.cookies;
  };

  it('consumers have no audit access (403)', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const consumerCookies = await addTeammate(
      owner,
      'consumer@example.com',
      'consumer',
    );
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit`,
      headers: { cookie: consumerCookies },
    });
    expect(res.statusCode).toBe(403);
  });

  it('producers get a limited view scoped to workflow categories', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producerCookies = await addTeammate(
      owner,
      'producer@example.com',
      'producer',
    );

    // Producer creates a project — writes a `project` category event.
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: producerCookies },
      payload: {
        slug: 'p1',
        name: 'P1',
        templateSlug: 'general_provenance',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit`,
      headers: { cookie: producerCookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      scope: string;
      events: Array<{ category: string; action: string }>;
    };
    expect(body.scope).toBe('limited');
    // The workflow event is visible...
    expect(body.events.some((e) => e.action === 'project.created')).toBe(true);
    // ...but the access-control / identity events are filtered out.
    expect(
      body.events.every(
        (e) =>
          e.category !== 'access_control' &&
          e.category !== 'identity_session',
      ),
    ).toBe(true);
  });

  it('non-members cannot read the audit log (404, no enumeration)', async () => {
    const owner = await register('owner@example.com', 'password123');
    const stranger = await register('stranger@example.com', 'password123');
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit`,
      headers: { cookie: stranger.cookies },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /tenants/:slug/audit/export', () => {
  it('exports workspace audit events as JSON and records the export event', async () => {
    const owner = await register('owner@example.com', 'password123');
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'export-project', name: 'Export Project' },
    });
    const [project] = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.projects
      WHERE tenant_id = ${owner.tenant.id}
        AND slug = 'export-project'
      LIMIT 1`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit/export?format=json&projectId=${project!.id}`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain(
      `proveria-${owner.tenant.slug}-events-`,
    );
    const body = res.json() as {
      export: { format: string; rowCount: number };
      events: Array<{ action: string; targetType: string; targetId: string }>;
    };
    expect(body.export.format).toBe('json');
    expect(body.export.rowCount).toBe(1);
    expect(body.events).toEqual([
      expect.objectContaining({
        action: 'project.created',
        targetType: 'project',
        targetId: project!.id,
      }),
    ]);

    const auditRows = await dbHandle.sql<{ action: string }[]>`
      SELECT action FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
        AND action = 'audit_export.created'`;
    expect(auditRows).toHaveLength(1);
  });

  it('exports workspace audit events as CSV with actor and category filters', async () => {
    const owner = await register('owner@example.com', 'password123');
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'csv-project', name: 'CSV Project' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit/export?format=csv&actorUserId=${owner.user.id}&category=project`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain(
      'id,createdAt,category,action,actorUserId,actorEmail',
    );
    expect(res.body).toContain('"project.created"');
    expect(res.body).toContain('"owner@example.com"');
  });

  it('rejects invalid audit export date filters', async () => {
    const owner = await register('owner@example.com', 'password123');
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit/export?from=not-a-date`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(
      'invalid_date_filter',
    );
  });

  it('denies audit export to producers', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit/export`,
      headers: { cookie: producer.cookies },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /tenants/:slug/organization/audit/export', () => {
  it('exports organization audit events across workspaces as JSON', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);

    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'workspace-one-project', name: 'Workspace One Project' },
    });

    const createWorkspace = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Second Workspace' },
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspace = (createWorkspace.json() as {
      tenant: { id: string; slug: string; name: string };
    }).tenant;

    await app.inject({
      method: 'POST',
      url: `/tenants/${workspace.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'workspace-two-project', name: 'Workspace Two Project' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/organization/audit/export?format=json&category=project`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain(
      'proveria-organization-events-',
    );
    const body = res.json() as {
      export: { rowCount: number };
      events: Array<{
        action: string;
        workspace: { id: string; slug: string; name: string };
      }>;
    };
    expect(body.export.rowCount).toBeGreaterThanOrEqual(2);
    expect(body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'project.created',
          workspace: expect.objectContaining({ slug: owner.tenant.slug }),
        }),
        expect.objectContaining({
          action: 'project.created',
          workspace: expect.objectContaining({ slug: workspace.slug }),
        }),
      ]),
    );

    const auditRows = await dbHandle.sql<{ action: string; target_type: string }[]>`
      SELECT action, target_type FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
        AND action = 'audit_export.created'
        AND target_type = 'organization_audit_export'`;
    expect(auditRows).toHaveLength(1);
  });

  it('exports organization audit events as CSV with workspace columns and workspace filter', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const createWorkspace = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'CSV Workspace' },
    });
    expect(createWorkspace.statusCode).toBe(201);
    const workspace = (createWorkspace.json() as {
      tenant: { id: string; slug: string };
    }).tenant;

    await app.inject({
      method: 'POST',
      url: `/tenants/${workspace.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'csv-workspace-project', name: 'CSV Workspace Project' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/organization/audit/export?format=csv&workspaceId=${workspace.id}&category=project`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain(
      'workspaceId,workspaceSlug,workspaceName,id,createdAt,category,action',
    );
    expect(res.body).toContain(`"${workspace.slug}"`);
    expect(res.body).toContain('"project.created"');
    expect(res.body).not.toContain(`"${owner.tenant.slug}"`);
  });

  it('denies organization audit export to non-organization admins', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/organization/audit/export`,
      headers: { cookie: producer.cookies },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /tenants/:slug/evidence-export/manifest', () => {
  it('exports an evidence artifact manifest by project', async () => {
    const owner = await register('owner@example.com', 'password123');
    const projectRes = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'evidence-export', name: 'Evidence Export' },
    });
    const project = (projectRes.json() as { project: { id: string } }).project;
    const [attestation] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.attestations
        (
          tenant_id,
          project_id,
          label,
          created_by_user_id,
          state,
          merkle_root,
          manifest_object_key,
          leaves_object_key,
          receipt_json_object_key,
          receipt_pdf_object_key,
          package_id,
          confirmed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${project.id},
        'export-me',
        ${owner.user.id},
        'confirmed',
        'abc123',
        'tenants/export/manifest.json',
        'tenants/export/leaves.jsonl',
        'tenants/export/receipt.json',
        'tenants/export/receipt.pdf',
        'pkg_export',
        now()
      )
      RETURNING id`;
    const [attempt] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.submission_attempts
        (
          attestation_id,
          state,
          manifest_object_key,
          leaves_object_key,
          validation_result_object_key,
          uploaded_at,
          validated_at
        )
      VALUES (
        ${attestation!.id},
        'confirmed',
        'tenants/export/attempt-manifest.json',
        'tenants/export/attempt-leaves.jsonl',
        'tenants/export/validation-result.json',
        now(),
        now()
      )
      RETURNING id`;
    await dbHandle.sql`
      UPDATE public.attestations
      SET confirmed_attempt_id = ${attempt!.id}
      WHERE id = ${attestation!.id}`;
    await dbHandle.sql`
      INSERT INTO public.verification_results
        (
          package_id,
          attestation_id,
          tenant_id,
          looked_up_by_user_id,
          result_type,
          submitted_hash,
          result_object_key,
          signed
        )
      VALUES (
        'pkg_lookup_export',
        ${attestation!.id},
        ${owner.tenant.id},
        ${owner.user.id},
        'match',
        ${'a'.repeat(64)},
        'tenants/export/result.json',
        'true'
      )`;
    await dbHandle.sql`
      INSERT INTO public.verification_links
        (id, tenant_id, target_type, target_ref, created_by_user_id)
      VALUES
        ('vrf_receipt_export', ${owner.tenant.id}, 'receipt', ${attestation!.id}, ${owner.user.id}),
        ('vrf_result_export', ${owner.tenant.id}, 'lookup_result', 'pkg_lookup_export', ${owner.user.id})`;
    await dbHandle.sql`
      INSERT INTO audit.audit_events
        (tenant_id, actor_user_id, category, action, target_type, target_id, payload)
      VALUES
        (
          ${owner.tenant.id},
          ${owner.user.id},
          'attestation_lifecycle',
          'attestation.confirmed',
          'attestation',
          ${attestation!.id},
          '{}'::jsonb
        )`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/manifest?projectId=${project.id}&includeEvents=true`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      export: {
        counts: {
          attestations: number;
          attempts: number;
          verificationResults: number;
          verificationLinks: number;
          events: number;
        };
      };
      attestations: Array<{
        id: string;
        artifacts: { receiptJson: string; receiptPdf: string };
      }>;
      attempts: Array<{ artifacts: { validationResult: string } }>;
      verificationResults: Array<{ packageId: string }>;
      verificationLinks: Array<{ id: string }>;
      events: Array<{ action: string }>;
    };
    expect(body.export.counts).toMatchObject({
      attestations: 1,
      attempts: 1,
      verificationResults: 1,
      verificationLinks: 2,
      events: 1,
    });
    expect(body.attestations[0]).toMatchObject({
      id: attestation!.id,
      artifacts: {
        receiptJson: 'tenants/export/receipt.json',
        receiptPdf: 'tenants/export/receipt.pdf',
      },
    });
    expect(body.attempts[0]?.artifacts.validationResult).toBe(
      'tenants/export/validation-result.json',
    );
    expect(body.verificationResults[0]?.packageId).toBe('pkg_lookup_export');
    expect(body.verificationLinks.map((link) => link.id).sort()).toEqual([
      'vrf_receipt_export',
      'vrf_result_export',
    ]);
    expect(body.events[0]?.action).toBe('attestation.confirmed');

    const auditRows = await dbHandle.sql<{ action: string }[]>`
      SELECT action FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
        AND action = 'evidence_export.created'`;
    expect(auditRows).toHaveLength(1);
  });

  it('exports organization-scoped evidence manifests across workspaces for org admins', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const primaryProjectRes = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'primary-evidence', name: 'Primary Evidence' },
    });
    const primaryProject = (primaryProjectRes.json() as {
      project: { id: string };
    }).project;
    const workspaceRes = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Legal Workspace' },
    });
    expect(workspaceRes.statusCode).toBe(201);
    const workspace = (workspaceRes.json() as {
      tenant: { id: string; slug: string; name: string };
    }).tenant;
    const legalProjectRes = await app.inject({
      method: 'POST',
      url: `/tenants/${workspace.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'legal-evidence', name: 'Legal Evidence' },
    });
    const legalProject = (legalProjectRes.json() as {
      project: { id: string };
    }).project;

    await dbHandle.sql`
      INSERT INTO public.attestations
        (
          tenant_id,
          project_id,
          label,
          created_by_user_id,
          state,
          merkle_root,
          manifest_object_key,
          leaves_object_key,
          receipt_json_object_key,
          receipt_pdf_object_key,
          package_id,
          confirmed_at
        )
      VALUES
        (
          ${owner.tenant.id},
          ${primaryProject.id},
          'workspace-export-one',
          ${owner.user.id},
          'confirmed',
          'workspace-root-one',
          'tenants/org-export/one-manifest.json',
          'tenants/org-export/one-leaves.jsonl',
          'tenants/org-export/one-receipt.json',
          'tenants/org-export/one-receipt.pdf',
          'pkg_org_one',
          now()
        ),
        (
          ${workspace.id},
          ${legalProject.id},
          'workspace-export-two',
          ${owner.user.id},
          'confirmed',
          'workspace-root-two',
          'tenants/org-export/two-manifest.json',
          'tenants/org-export/two-leaves.jsonl',
          'tenants/org-export/two-receipt.json',
          'tenants/org-export/two-receipt.pdf',
          'pkg_org_two',
          now()
        )`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/manifest?scope=organization&includeEvents=false`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      export: {
        scope: string;
        counts: { attestations: number };
        organization: { id: string; name: string } | null;
        workspaces: Array<{ id: string; slug: string; name: string }>;
        filters: { scope: string };
      };
      attestations: Array<{
        label: string;
        workspace: { id: string; slug: string; name: string };
      }>;
    };
    expect(body.export.scope).toBe('organization');
    expect(body.export.filters.scope).toBe('organization');
    expect(body.export.organization?.id).toEqual(expect.any(String));
    expect(body.export.counts.attestations).toBe(2);
    expect(body.export.workspaces.map((entry) => entry.slug).sort()).toEqual(
      [owner.tenant.slug, workspace.slug].sort(),
    );
    expect(body.attestations.map((row) => row.workspace.slug).sort()).toEqual(
      [owner.tenant.slug, workspace.slug].sort(),
    );
  });

  it('denies evidence export manifests to producers', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/manifest`,
      headers: { cookie: producer.cookies },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /tenants/:slug/evidence-export/jobs', () => {
  it('creates a queued evidence export job with a manifest', async () => {
    const owner = await register('owner@example.com', 'password123');
    const projectRes = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'job-export', name: 'Job Export' },
    });
    const project = (projectRes.json() as { project: { id: string } }).project;
    const [attestation] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.attestations
        (
          tenant_id,
          project_id,
          label,
          created_by_user_id,
          state,
          merkle_root,
          manifest_object_key,
          leaves_object_key,
          receipt_json_object_key,
          receipt_pdf_object_key,
          package_id,
          confirmed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${project.id},
        'job-export-me',
        ${owner.user.id},
        'confirmed',
        'abc123',
        'tenants/export-job/manifest.json',
        'tenants/export-job/leaves.jsonl',
        'tenants/export-job/receipt.json',
        'tenants/export-job/receipt.pdf',
        'pkg_export_job',
        now()
      )
      RETURNING id`;
    storedBytes.set(
      'tenants/export-job/manifest.json',
      Buffer.from('{"schema_version":"1.0"}'),
    );
    storedBytes.set(
      'tenants/export-job/leaves.jsonl',
      Buffer.from('{"leaf_type":"file/sha256/v1"}\n'),
    );
    storedBytes.set(
      'tenants/export-job/receipt.json',
      Buffer.from('{"package_id":"pkg_export_job"}'),
    );
    storedBytes.set(
      'tenants/export-job/receipt.pdf',
      Buffer.from('%PDF-1.4\nexport job receipt\n'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs`,
      headers: { cookie: owner.cookies },
      payload: { projectId: project.id, includeEvents: false },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      job: {
        id: string;
        kind: string;
        status: string;
        artifactCount: number;
        rowCount: number;
        resultObjectKey: string | null;
      };
      manifest: {
        export: { counts: { attestations: number } };
        attestations: Array<{
          id: string;
          artifacts: { receiptJson: string; receiptPdf: string };
        }>;
      };
    };
    expect(body.job).toMatchObject({
      kind: 'evidence_bundle',
      status: 'queued',
      artifactCount: 4,
      rowCount: 1,
      resultObjectKey: null,
    });
    expect(evidenceExportJobs).toEqual([{ jobId: body.job.id }]);
    expect(body.manifest.export.counts.attestations).toBe(1);
    expect(body.manifest.attestations[0]).toMatchObject({
      id: attestation!.id,
      artifacts: {
        receiptJson: 'tenants/export-job/receipt.json',
        receiptPdf: 'tenants/export-job/receipt.pdf',
      },
    });
    const bundleRes = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs/${body.job.id}/bundle`,
      headers: { cookie: owner.cookies },
    });
    expect(bundleRes.statusCode).toBe(404);

    const jobs = await dbHandle.sql<{ status: string; artifact_count: number }[]>`
      SELECT status, artifact_count FROM public.export_jobs
      WHERE tenant_id = ${owner.tenant.id}`;
    expect(jobs).toEqual([{ status: 'queued', artifact_count: 4 }]);
  });

  it('creates organization-scoped queued evidence export jobs for org admins', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const primaryProjectRes = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'primary-job-export', name: 'Primary Job Export' },
    });
    const primaryProject = (primaryProjectRes.json() as {
      project: { id: string };
    }).project;
    const workspaceRes = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/workspaces`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Finance Workspace' },
    });
    const workspace = (workspaceRes.json() as {
      tenant: { id: string; slug: string; name: string };
    }).tenant;
    const financeProjectRes = await app.inject({
      method: 'POST',
      url: `/tenants/${workspace.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug: 'finance-evidence', name: 'Finance Evidence' },
    });
    const financeProject = (financeProjectRes.json() as {
      project: { id: string };
    }).project;

    const [primary] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.attestations
        (
          tenant_id,
          project_id,
          label,
          created_by_user_id,
          state,
          merkle_root,
          manifest_object_key,
          package_id,
          confirmed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${primaryProject.id},
        'organization-job-one',
        ${owner.user.id},
        'confirmed',
        'organization-job-root-one',
        'tenants/org-job/one-manifest.json',
        'pkg_org_job_one',
        now()
      )
      RETURNING id`;
    const [secondary] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.attestations
        (
          tenant_id,
          project_id,
          label,
          created_by_user_id,
          state,
          merkle_root,
          manifest_object_key,
          package_id,
          confirmed_at
        )
      VALUES (
        ${workspace.id},
        ${financeProject.id},
        'organization-job-two',
        ${owner.user.id},
        'confirmed',
        'organization-job-root-two',
        'tenants/org-job/two-manifest.json',
        'pkg_org_job_two',
        now()
      )
      RETURNING id`;
    storedBytes.set(
      'tenants/org-job/one-manifest.json',
      Buffer.from('{"id":"one"}'),
    );
    storedBytes.set(
      'tenants/org-job/two-manifest.json',
      Buffer.from('{"id":"two"}'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs`,
      headers: { cookie: owner.cookies },
      payload: { scope: 'organization', includeEvents: false },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      job: {
        id: string;
        status: string;
        artifactCount: number;
        rowCount: number;
        resultObjectKey: string | null;
      };
      manifest: {
        export: {
          scope: string;
          counts: { attestations: number };
          workspaces: Array<{ slug: string }>;
        };
        attestations: Array<{
          id: string;
          workspace: { slug: string };
        }>;
      };
    };
    expect(body.job).toMatchObject({
      status: 'queued',
      artifactCount: 2,
      rowCount: 2,
      resultObjectKey: null,
    });
    expect(evidenceExportJobs).toEqual([{ jobId: body.job.id }]);
    expect(body.manifest.export.scope).toBe('organization');
    expect(body.manifest.export.counts.attestations).toBe(2);
    expect(body.manifest.export.workspaces.map((entry) => entry.slug).sort()).toEqual(
      [owner.tenant.slug, workspace.slug].sort(),
    );
    expect(body.manifest.attestations.map((row) => row.id).sort()).toEqual(
      [primary!.id, secondary!.id].sort(),
    );
  });

  it('denies evidence export jobs to producers', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs`,
      headers: { cookie: producer.cookies },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /tenants/:slug/evidence-export/jobs', () => {
  it('lists recent evidence export jobs for tenant admins', async () => {
    const owner = await register('owner@example.com', 'password123');
    await dbHandle.sql`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          artifact_count,
          row_count,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{"projectId":"project-1","includeEvents":true}'::jsonb,
        7,
        3,
        now()
      )`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      jobs: Array<{
        kind: string;
        status: string;
        filters: { projectId: string; includeEvents: boolean };
        artifactCount: number;
        rowCount: number;
        completedAt: string | null;
      }>;
    };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({
      kind: 'evidence_bundle',
      status: 'completed',
      filters: { projectId: 'project-1', includeEvents: true },
      artifactCount: 7,
      rowCount: 3,
    });
    expect(body.jobs[0]?.completedAt).toEqual(expect.any(String));
  });

  it('gets an evidence export job manifest for tenant admins', async () => {
    const owner = await register('owner@example.com', 'password123');
    const [job] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          manifest,
          artifact_count,
          row_count,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{"includeEvents":true}'::jsonb,
        '{"export":{"counts":{"attestations":1}},"attestations":[{"id":"att-1"}]}'::jsonb,
        4,
        1,
        now()
      )
      RETURNING id`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs/${job!.id}`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      job: {
        id: string;
        kind: string;
        status: string;
        artifactCount: number;
        rowCount: number;
      };
      manifest: {
        export: { counts: { attestations: number } };
        attestations: Array<{ id: string }>;
      };
    };
    expect(body.job).toMatchObject({
      id: job!.id,
      kind: 'evidence_bundle',
      status: 'completed',
      artifactCount: 4,
      rowCount: 1,
    });
    expect(body.manifest.export.counts.attestations).toBe(1);
    expect(body.manifest.attestations[0]).toEqual({ id: 'att-1' });
  });

  it('denies evidence export job manifests to producers', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );
    const [job] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          manifest,
          artifact_count,
          row_count,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{}'::jsonb,
        '{"export":{"counts":{"attestations":0}}}'::jsonb,
        0,
        0,
        now()
      )
      RETURNING id`;

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs/${job!.id}`,
      headers: { cookie: producer.cookies },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies evidence export job listing to producers', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs`,
      headers: { cookie: producer.cookies },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /tenants/:slug/evidence-export/jobs/cleanup-expired', () => {
  it('deletes expired bundle objects with retention opt-in and audits the deletion', async () => {
    const owner = await register('owner@example.com', 'password123');
    storedBytes.set('tenants/export-job/delete-me.json', Buffer.from('{}'));
    storedBytes.set('tenants/export-job/keep-me.json', Buffer.from('{}'));
    const [expired] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          manifest,
          artifact_count,
          row_count,
          result_object_key,
          expires_at,
          retention_policy,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{}'::jsonb,
        '{"export":{"counts":{"attestations":0}}}'::jsonb,
        1,
        1,
        'tenants/export-job/delete-me.json',
        now() - interval '1 day',
        '{"retention_days":30,"delete_after_expiration":true}'::jsonb,
        now() - interval '2 days'
      )
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          manifest,
          artifact_count,
          row_count,
          result_object_key,
          expires_at,
          retention_policy,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{}'::jsonb,
        '{"export":{"counts":{"attestations":0}}}'::jsonb,
        1,
        1,
        'tenants/export-job/keep-me.json',
        now() - interval '1 day',
        '{"retention_days":30,"delete_after_expiration":false}'::jsonb,
        now() - interval '2 days'
      )`;

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs/cleanup-expired`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      scanned: 2,
      deleted: 1,
      skipped: 1,
      deletedObjectKeys: ['tenants/export-job/delete-me.json'],
    });
    expect(deletedObjectKeys).toEqual(['tenants/export-job/delete-me.json']);
    expect(storedBytes.has('tenants/export-job/delete-me.json')).toBe(false);
    expect(storedBytes.has('tenants/export-job/keep-me.json')).toBe(true);

    const rows = await dbHandle.sql<
      Array<{ id: string; status: string; result_object_key: string | null }>
    >`
      SELECT id, status, result_object_key
      FROM public.export_jobs
      ORDER BY result_object_key NULLS FIRST, id`;
    expect(rows.find((row) => row.id === expired!.id)).toMatchObject({
      status: 'expired',
      result_object_key: null,
    });

    const auditRows = await dbHandle.sql<
      Array<{ action: string; category: string; target_type: string; target_id: string }>
    >`
      SELECT action, category, target_type, target_id
      FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
        AND action = 'evidence_export.expired'`;
    expect(auditRows).toEqual([
      {
        action: 'evidence_export.expired',
        category: 'retention_deletion',
        target_type: 'evidence_export_job',
        target_id: expired!.id,
      },
    ]);

    const replay = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs/cleanup-expired`,
      headers: { cookie: owner.cookies },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ scanned: 1, deleted: 0, skipped: 1 });
    expect(deletedObjectKeys).toEqual(['tenants/export-job/delete-me.json']);
  });

  it('denies cleanup to producers', async () => {
    const owner = await register('owner@example.com', 'password123');
    await upgradeToTeamPro(owner.tenant.id);
    const producer = await inviteAndAccept(
      owner,
      'producer@example.com',
      'producer',
    );

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/evidence-export/jobs/cleanup-expired`,
      headers: { cookie: producer.cookies },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Enterprise audit hash chain (M9 / C32)', () => {
  it('Enterprise tenant writes a hash-chain row for each audit event; chain re-walks consistently', async () => {
    const owner = await register('owner@example.com', 'password123');
    // Promote the tenant to Enterprise so the chain fires.
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'enterprise' WHERE id = ${owner.tenant.id}`;

    // Trigger two audit events on this tenant by inviting + revoking a teammate.
    const invite = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'mate@example.com', role: 'producer' },
    });
    const inviteId = (
      invite.json() as { invitation: { id: string } }
    ).invitation.id;
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations/${inviteId}/revoke`,
      headers: { cookie: owner.cookies },
    });

    // Pull every chain row for the tenant in order.
    const chainRows = await dbHandle.db
      .select()
      .from(auditEventHashChain)
      .where(eq(auditEventHashChain.tenantId, owner.tenant.id))
      .orderBy(auditEventHashChain.sequenceNum);
    // The two invitation actions add at least 2 chain rows; registration
    // ones may or may not be chained depending on plan at write time.
    expect(chainRows.length).toBeGreaterThanOrEqual(2);

    // Re-walk every chain row from the actual audit_events row; the
    // recomputed this_hash must equal the stored one (proves no tamper).
    for (const row of chainRows) {
      const [event] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.id, row.eventId))
        .limit(1);
      if (!event) throw new Error('missing audit event');
      const expected = computeChainHash(row.prevHash, event);
      expect(row.thisHash).toBe(expected);
    }

    // Sequence numbers are monotonic + dense; each prevHash matches the
    // previous thisHash; first row uses the genesis hash.
    expect(chainRows[0]?.sequenceNum).toBe(1);
    expect(chainRows[0]?.prevHash).toBe(CHAIN_GENESIS_HEX);
    for (let i = 1; i < chainRows.length; i += 1) {
      expect(chainRows[i]!.sequenceNum).toBe(
        chainRows[i - 1]!.sequenceNum + 1,
      );
      expect(chainRows[i]!.prevHash).toBe(chainRows[i - 1]!.thisHash);
    }
  });

  it('non-Enterprise (Free) tenant audit events do NOT produce chain rows', async () => {
    const owner = await register('owner@example.com', 'password123');
    // Owner is on the free plan by default. Trigger an audit event Free
    // CAN actually perform — invitations are now capped at 1 user on Free
    // (M13/C50) so we use a project create instead.
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'p1',
        name: 'P1',
        templateSlug: 'general_provenance',
      },
    });
    const chainRows = await dbHandle.db
      .select()
      .from(auditEventHashChain)
      .where(eq(auditEventHashChain.tenantId, owner.tenant.id));
    expect(chainRows).toHaveLength(0);
  });

  it('Enterprise admin can checkpoint the chain; root matches a re-computed Merkle root', async () => {
    const owner = await register('owner@example.com', 'password123');
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'enterprise' WHERE id = ${owner.tenant.id}`;
    // Generate a couple of chain entries.
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'a@example.com', role: 'producer' },
    });
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'b@example.com', role: 'producer' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/audit/checkpoint`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      checkpoint: {
        id: string;
        firstSeq: number;
        lastSeq: number;
        merkleRoot: string;
      };
    };
    expect(body.checkpoint.firstSeq).toBe(1);
    expect(body.checkpoint.lastSeq).toBeGreaterThanOrEqual(2);
    expect(body.checkpoint.merkleRoot).toMatch(/^[0-9a-f]{64}$/);

    // Re-compute the root from chain rows in [firstSeq, lastSeq] (the
    // checkpoint window — newer rows like the audit_checkpoint.created event
    // itself are excluded).
    const rows = await dbHandle.db
      .select({ thisHash: auditEventHashChain.thisHash })
      .from(auditEventHashChain)
      .where(eq(auditEventHashChain.tenantId, owner.tenant.id))
      .orderBy(asc(auditEventHashChain.sequenceNum));
    const windowRows = rows.slice(
      body.checkpoint.firstSeq - 1,
      body.checkpoint.lastSeq,
    );
    const recomputed = Buffer.from(
      computeMerkleRoot(
        windowRows.map(
          (r) => new Uint8Array(Buffer.from(r.thisHash, 'hex')),
        ),
      ),
    ).toString('hex');
    expect(recomputed).toBe(body.checkpoint.merkleRoot);

    // A second checkpoint immediately after returns 409 no_new_chain_entries.
    // (The audit_checkpoint.created event itself adds a chain row; second
    // checkpoint should cover just that one row.)
    const second = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/audit/checkpoint`,
      headers: { cookie: owner.cookies },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as {
      checkpoint: { firstSeq: number; lastSeq: number };
    };
    expect(secondBody.checkpoint.firstSeq).toBe(body.checkpoint.lastSeq + 1);

    // Persisted checkpoint rows present.
    const stored = await dbHandle.db
      .select()
      .from(auditCheckpoints)
      .where(eq(auditCheckpoints.tenantId, owner.tenant.id));
    expect(stored.length).toBeGreaterThanOrEqual(2);
  });

  it('Free-tier tenant cannot create a checkpoint (409 enterprise_only)', async () => {
    const owner = await register('owner@example.com', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/audit/checkpoint`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('enterprise_only');
  });
});
