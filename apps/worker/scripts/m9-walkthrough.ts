// M9 walkthrough — seeds an Enterprise tenant with enough audit activity to
// exercise the hash chain, checkpoints, and tamper detection on the portal
// /tenants/:slug/audit page.
//
// Run: pnpm --filter @proveria/worker walkthrough:m9

import { randomUUID } from 'node:crypto';

import { createClient, type ClientHandle } from '@proveria/db';

const API = process.env.API_URL ?? 'http://127.0.0.1:3001';
const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';

const log = (...a: unknown[]): void => console.log(...a);
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const sessionReq = async <T>(
  cookie: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

const main = async (): Promise<void> => {
  log('\nProveria — M9 walkthrough\n' + '─'.repeat(48));
  for (const [name, url] of [
    ['api', `${API}/healthz`],
    ['portal', PORTAL],
  ]) {
    try {
      const r = await fetch(url);
      if (!r.ok) fail(`${name} ${r.status} (${url})`);
    } catch {
      fail(`${name} not reachable at ${url}`);
    }
  }
  log('✓ stack reachable\n');

  const suffix = randomUUID().slice(0, 8);
  const email = `m9-admin-${suffix}@example.com`;
  const password = 'm9-walkthrough-pw-123';

  // 1. Register the admin.
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (reg.status !== 201) fail(`register → ${reg.status}`);
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!;
  const regBody = (await reg.json()) as {
    tenant: { id: string; slug: string };
  };
  const tenantId = regBody.tenant.id;
  const tenantSlug = regBody.tenant.slug;
  log(`1. registered  → ${email} / tenant ${tenantSlug}`);

  // 2. Upgrade to Enterprise so the hash chain fires for every audit event.
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'enterprise' WHERE id = ${tenantId}`;
  } finally {
    await handle.close();
  }
  log('2. plan        → Enterprise (chain + checkpoints enabled)');

  // 3. Trigger a few audit events: create a project, send + revoke an invite.
  await sessionReq(cookie, 'POST', `/tenants/${tenantSlug}/projects`, {
    slug: 'audit-demo',
    name: 'Audit demo',
    templateSlug: 'general_provenance',
  });
  const invite = await sessionReq<{ invitation: { id: string } }>(
    cookie,
    'POST',
    `/tenants/${tenantSlug}/invitations`,
    { email: `mate-${suffix}@example.com`, role: 'producer' },
  );
  await sessionReq(
    cookie,
    'POST',
    `/tenants/${tenantSlug}/invitations/${invite.invitation.id}/revoke`,
  );
  log('3. audit       → project.created + invitation.created + invitation.revoked');

  // 4. Show current chain state.
  const integrity = await sessionReq<{
    chainLength: number;
    lastSequenceNum: number;
    verification: { ok: boolean };
  }>(cookie, 'GET', `/tenants/${tenantSlug}/audit/integrity`);
  log(
    `4. chain       → length=${integrity.chainLength}, lastSeq=${integrity.lastSequenceNum}, verify=${integrity.verification.ok ? 'intact' : 'TAMPER'}`,
  );

  log('\n' + '─'.repeat(48));
  log('✓ TENANT SEEDED');
  log('─'.repeat(48));
  log(`
LOGIN

  ${email}  /  ${password}

THINGS TO VERIFY BY HAND — Milestone 9
======================================

C32 + C34 — Audit integrity card (Enterprise-only)
  ${PORTAL}/tenants/${tenantSlug}/audit
    • The "Audit integrity" card shows chain length ${integrity.chainLength},
      last sequence ${integrity.lastSequenceNum}, the most recent chain
      hash in mono, and a "chain intact" badge.
    • The event list below shows the full audit trail (scope: full —
      Enterprise plan gets every category).

C33 — Create a checkpoint
  Click "Create checkpoint" — it computes a Merkle root over the chain
  entries since the last checkpoint and adds a row to the "Recent
  checkpoints" table just below. Click it again — second checkpoint
  covers just the audit_checkpoint.created event itself.

C32 — Tamper demo (proves the chain catches post-hoc edits)
  In a terminal, run this SQL to mutate one audit_event payload after
  the chain has already hashed it:

    psql "${DATABASE_URL}" -c "
      UPDATE audit.audit_events
      SET payload = '{\\"tampered\\": true}'::jsonb
      WHERE tenant_id = '${tenantId}'
        AND action = 'project.created';"

  Then click "Refresh" / reload the audit page. The verification badge
  flips to "TAMPER at seq <N>" with N being the chain sequence number
  of the mutated row. The underlying signed evidence (manifests,
  receipts, packages) is unaffected — only the audit row is in
  question, and the chain says so loudly.

  To restore (you'll need the original payload — it's a {"slug": ...,
  "templateSlug": ..., "visibility": ...} object; for this demo, just
  re-run the walkthrough script to seed a fresh tenant):
    pnpm --filter @proveria/worker walkthrough:m9
`);
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
