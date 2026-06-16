// Personas walkthrough — seeds the four V1 personas as separate accounts
// with consistent credentials, then prints a step-by-step guide naming the
// app (portal vs desktop) for each action.
//
// What this script does PROGRAMMATICALLY:
//   1. Registers the four accounts at the API
//   2. Upgrades the customer-admin tenant to Team Pro
//   3. Adds the producer to the customer-admin tenant as a 'producer'
//      (via direct SQL, skipping the invitation flow for setup convenience
//      — the printed walkthrough explains the real invitation flow you'd
//      use in production)
//   4. Leaves projects, attestations, devices, and grants UNSEEDED so the
//      personas create them through the actual user surfaces.
//
// What the WALKTHROUGH itself covers (after this script runs):
//   - Customer admin: portal — create project, manage members, grant
//     access to the consumer.
//   - Producer: desktop — pair device, run the wizard, submit an
//     attestation.
//   - Consumer: portal — sign in, see granted attestations, verify a hash.
//   - Platform admin: portal /admin/* — failed-job + failed-attestation
//     observability (requires the api to be started with
//     PROVERIA_PLATFORM_ADMINS env var set — the script prints the line).

import { createHash, randomBytes, randomUUID } from 'node:crypto';

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

interface Registered {
  email: string;
  password: string;
  userId: string;
  // Null when the user registered via a grant token (consumers have no
  // tenant). Non-grant flows always return a tenant.
  tenantId: string | null;
  tenantSlug: string | null;
}

const registerAccount = async (
  email: string,
  password: string,
  invitationToken?: string,
): Promise<Registered> => {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      ...(invitationToken ? { invitationToken } : {}),
    }),
  });
  if (res.status !== 201) {
    fail(`register ${email} → ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    user: { id: string };
    tenant: { id: string; slug: string } | null;
  };
  return {
    email,
    password,
    userId: body.user.id,
    tenantId: body.tenant?.id ?? null,
    tenantSlug: body.tenant?.slug ?? null,
  };
};

// Seed an invitation row directly via SQL. The API has a session-auth
// POST /tenants/:slug/invitations route but it would require a session
// cookie for the customer admin; the SQL shortcut keeps this script
// self-contained. The token returned is the plaintext value the new
// user passes to /auth/register.
const seedInvitationDirectly = async (
  databaseUrl: string,
  tenantId: string,
  invitedByUserId: string,
  invitedEmail: string,
  role: 'producer' | 'consumer' | 'tenant_admin',
): Promise<string> => {
  const token = randomBytes(32).toString('hex');
  // hashToken in apps/api/src/auth/tokens.ts uses base64url over UTF-8 —
  // the SQL seed has to match exactly or the api won't find the row.
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('base64url');
  const expiresAt = new Date(
    Date.now() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const handle: ClientHandle = createClient({ url: databaseUrl, max: 1 });
  try {
    await handle.sql`
      INSERT INTO public.tenant_invitations
        (tenant_id, invited_by_user_id, email, role, token_hash, expires_at)
      VALUES (${tenantId}, ${invitedByUserId}, ${invitedEmail}, ${role},
              ${tokenHash}, ${expiresAt})`;
  } finally {
    await handle.close();
  }
  return token;
};

const main = async (): Promise<void> => {
  log('\nProveria — personas walkthrough setup\n' + '─'.repeat(56));

  for (const [name, url] of [
    ['api', `${API}/healthz`],
    ['portal', PORTAL],
  ]) {
    try {
      const r = await fetch(url);
      if (!r.ok) fail(`${name} reachable but ${r.status} (${url})`);
    } catch {
      fail(`${name} not reachable at ${url}`);
    }
  }
  log('✓ stack reachable\n');

  // Unique suffix so re-running the script doesn't collide with prior runs.
  const suffix = randomUUID().slice(0, 6);
  const password = 'personas-walkthrough-pw-123';

  // Self-register the customer admin first. NODE_ENV is dev so the
  // sample-content seeder fires automatically (sample project + sample
  // attestation in their personal tenant). docs/getting-started.md §1.
  const customerAdmin = await registerAccount(
    `customer-admin-${suffix}@example.com`,
    password,
  );
  log('1. customer admin  → ' + customerAdmin.email + '  (workspace seeded)');

  // Upgrade to Team Pro so they can host multiple users + shingling.
  const handle: ClientHandle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${customerAdmin.tenantId}`;
  } finally {
    await handle.close();
  }
  log('   ✓ customer-admin tenant upgraded to Team Pro');

  // Producer joins the customer-admin tenant via invitation — no
  // personal tenant. We seed the invitation row via SQL (registration
  // accepts the token at signup time).
  const producerEmail = `producer-${suffix}@example.com`;
  const producerToken = await seedInvitationDirectly(
    DATABASE_URL,
    customerAdmin.tenantId,
    customerAdmin.userId,
    producerEmail,
    'producer',
  );
  const producer = await registerAccount(producerEmail, password, producerToken);
  log('2. producer        → ' + producer.email + '  (no personal tenant; joined as producer)');

  // Consumer is NOT pre-registered. In the real flow a consumer doesn't
  // have an account until a producer grants their email access to an
  // attestation; the grant mints a token, the consumer opens
  // /register?grant=<token>, registers, and the grant is auto-claimed.
  // The walkthrough Part 3 + Part 4 walk through that.
  const consumerEmail = `consumer-${suffix}@example.com`;
  log('3. consumer        → ' + consumerEmail + '  (NOT pre-registered; claims via grant)');

  // Platform admin self-registers like a regular user; their platform-
  // admin powers come from the env-var allowlist applied at api start.
  const platformAdmin = await registerAccount(
    `platform-admin-${suffix}@proveria.local`,
    password,
  );
  log('4. platform admin  → ' + platformAdmin.email + '  (allowlist below)');

  log('\n' + '═'.repeat(70));
  log('  CREDENTIALS  (password is the same for every account)');
  log('═'.repeat(70));
  log(`
  Password:  ${password}

  PLATFORM ADMIN   ${platformAdmin.email}
                   personal Free tenant: ${platformAdmin.tenantSlug}
                   platform-admin powers active only when the api is
                   started with the env var below.

  CUSTOMER ADMIN   ${customerAdmin.email}
                   Team Pro tenant slug: ${customerAdmin.tenantSlug}
                   role on that tenant:  tenant_admin

  PRODUCER         ${producer.email}
                   member of customer-admin tenant (${customerAdmin.tenantSlug})
                   role on that tenant:  producer
                   (no personal tenant — joined via invitation)

  CONSUMER         ${consumerEmail}
                   no account yet — created at PART 4 by following the
                   /register?grant=<token> link minted when the customer
                   admin grants access in PART 3. No tenant membership,
                   no personal tenant. Home is the granted-attestations
                   list.
`);

  log('═'.repeat(70));
  log('  WHICH APP DOES EACH PERSONA USE?');
  log('═'.repeat(70));
  log(`
  • Portal (web)   ${PORTAL}
                   Every persona uses the portal for sign-in, project +
                   attestation browsing, member + device management, audit
                   views, lookup, and admin observability.

  • Desktop app    pnpm --filter @proveria/desktop dev
                   Only PRODUCERS use the desktop. It pairs to one
                   tenant + user, hashes files locally, signs the
                   manifest with the device's Ed25519 key, and uploads
                   only the cryptographic metadata. Plaintext never
                   leaves the producer machine.

  • Hash CLI       pnpm --filter @proveria/hash-cli dev <subcmd>
                   Optional for consumers (and testers). \`file\`,
                   \`shingle\`, and \`verify\` subcommands re-derive
                   the same hashes the portal accepts and re-verify
                   lookup result packages with no network.
`);

  log('═'.repeat(70));
  log('  REAL FLOW WALKTHROUGH');
  log('═'.repeat(70));

  log(`
PART 1 — Customer admin sets up the workspace
─────────────────────────────────────────────
App: PORTAL
Sign in as:  ${customerAdmin.email}  /  ${password}
Land at:     ${PORTAL}/login

After login you'll see the customer-admin tenant in your list. Open it:
  ${PORTAL}/tenants/${customerAdmin.tenantSlug}

Step 1 — Create a project
  • Click "New project" on the tenant detail page.
  • Slug:        evidence-corpus
  • Name:        Evidence corpus
  • Template:    General Provenance
  • Visibility:  Private  (Team Pro can do private; Free can't)
  • Confirm. The project appears in the list.

Step 2 — Verify the producer is a member
  • Click "Settings" (top-right inside the tenant view).
    ${PORTAL}/tenants/${customerAdmin.tenantSlug}/settings
  • You should see two members in the "Members" table:
      - you (tenant_admin)
      - ${producer.email}  (producer)
  • You should also see a "Plan & usage" card at the top reading
    "Plan: Team Pro" with 1 project, 2 members, 0 attestations this month.

Step 3 — (Optional) try the invitation flow
  • In the same settings page, scroll to "Pending invitations".
  • Send yourself a fake invitation to dev-mate@example.com /
    role=producer to see the API surface. You can revoke it after.
  • Real production invitations would send an email; in dev they print
    the token to the api log as a structured log line tagged
    notification=tenant_invitation.

PART 2 — Producer pairs the desktop and submits an attestation
──────────────────────────────────────────────────────────────
App: DESKTOP
Launch:  pnpm --filter @proveria/desktop dev

The desktop opens at the pairing screen because no profile exists yet.

Step 4 — Pair the device
  • API base URL: ${API}
  • Device name:  whatever you like ("Demo Mac")
  • Click "Start pairing". A code appears (~6 chars).
  • Switch to the PORTAL, signed in as:
      ${producer.email}  /  ${password}
  • Open ${PORTAL}/tenants/${customerAdmin.tenantSlug}/devices
    (you'll see this in the tenant nav as "Pair device")
  • Enter the code, give the device a name, click Approve.
  • The desktop's "Waiting for approval…" line flips to the paired view.

Step 5 — Run the wizard end-to-end
  Step A — Project & label
    • Project slug:        evidence-corpus
    • Attestation label:   demo-${suffix}
    • Template:            General Provenance
  Step B — Files
    • Click "Add files…" and pick one or more local files (any size).
    • For the most demoable result, include a .txt or .pdf so shingling
      kicks in (Team Pro allows it).
  Step C — Review
    • Confirm the summary; click "Hash, sign & submit".
  Step D — Submitting
    • Files get SHA-256 hashed locally. PDFs / text get extracted +
      shingled locally. If a PDF has no text layer, OCR fires
      (tesseract.js, no network). The manifest is built, signed with
      the device's Ed25519 key, and uploaded.
  Step E — Done
    • You see the attestation id, attempt id, Merkle root, and
      "Processing cache: 0 reused, N re-hashed" (M12/C46).
  • Resubmit the same files and the cache hits jump to N reused.

Step 6 — Verify the result in the PORTAL
  • Signed in as ${producer.email}, navigate to:
    ${PORTAL}/tenants/${customerAdmin.tenantSlug}/projects/evidence-corpus
  • Your attestation is in the list with state "confirmed".
  • Click into it. You'll see the device signature, the Merkle root,
    the receipt download link, and verification-link controls.

PART 3 — Customer admin grants consumer access
──────────────────────────────────────────────
App: PORTAL  (signed in again as ${customerAdmin.email})

Step 7 — Grant the consumer access to the demo attestation
  • Open the attestation detail page (same URL as step 6).
  • Find the "Access grants" card.
  • Add ${consumerEmail} and click Grant.
  • The grant row appears as "pending" because no account exists for
    that email yet. The api log emits a structured line tagged
    notification=attestation_access_grant with a one-time token.
    You can revoke from this surface too.

Step 7.5 — Copy the grant token from the api log
  • Grep the api log for the line — example shape:
      [notify] attestation_access_grant to=${consumerEmail} ...
        token=<LONG_BASE64URL_STRING>
  • Build the claim URL:
      ${PORTAL}/register?grant=<LONG_BASE64URL_STRING>
  • Open it in a new browser window (or incognito so you don't disturb
    the customer-admin session).

PART 4 — Consumer claims the share + verifies the attestation
─────────────────────────────────────────────────────────────
App: PORTAL  (incognito / second browser)

Step 8 — Register and claim the grant
  • The /register?grant=<token> page shows the "Verify a shared
    attestation" copy.
  • Email:    ${consumerEmail}   (must match — case-insensitive)
  • Password: ${password}
  • Submit. You're logged in and routed to the home page; the demo
    attestation is already in the "Attestations shared with you" list
    (the grant was auto-claimed inside the register transaction).
  • Click into it; you'll land on the consumer lookup page (no
    producer-side controls visible).

Step 9 — Verify a file you happen to have
  • Compute the file's SHA-256 with the CLI:
      pnpm --filter @proveria/hash-cli dev file path/to/the/file
    Or use \`shasum -a 256 path\` — the bytes match.
  • Paste the 64-char hex hash into the lookup form.
  • A MATCH returns a result package with a Merkle proof + the
    Proveria signature. Download it.
  • Verify the package offline (no network):
      pnpm --filter @proveria/hash-cli dev verify path/to/package.json \\
          --public-key yTqV98Lh2ppAXQlcqVwXg7508MccQ757iIYrb67fUVY
    Exit 0 with "OK <package_id>" means math + Proveria signature
    both verified.
  • Try a NO-MATCH: paste 64 zeros. The result is the verbatim
    docs/protocol/v1 §9.3 no-match statement, still signed.

Step 10 — (Shingling, Team Pro only) verify a passage instead of a file
  • If the producer submitted a .txt file, the manifest also holds
    shingle leaves. Run:
      pnpm --filter @proveria/hash-cli dev shingle path/to/the/file.txt
    The CLI prints one canonical_payload_hash per shingle. Paste any
    one into the same portal lookup form for a MATCH against the
    shingle/sha256/v1 leaf type.

PART 5 — Platform admin observability (optional, requires restart)
──────────────────────────────────────────────────────────────────
App: PORTAL  (well, /admin/* JSON endpoints — no UI in V1)

Platform-admin powers are gated by an environment variable allowlist.
To activate them for ${platformAdmin.email}, stop the api and restart
with:

  PROVERIA_PLATFORM_ADMINS=${platformAdmin.email} pnpm --filter @proveria/api dev

Then, signed in to the portal as the platform admin, hit these JSON
endpoints in a browser tab (the portal proxies /admin/* through):

  ${PORTAL}/api/admin/queues
    → Per-queue waiting/active/completed/failed/delayed counts.
       Useful for "is anything stuck?" at-a-glance.

  ${PORTAL}/api/admin/queues/pdf-rendering/failed?limit=25
    → Recently-failed PDF render jobs. Each entry includes the
       carried-through requestId (M15/C55) so you can grep the api log
       for the originating request.

  ${PORTAL}/api/admin/attestations/failed?limit=25
    → Cross-tenant listing of attestations in failed_needs_review with
       the most recent attempt's validation_error attached. The
       actionable view for operator outreach.

Sign-in attempts by non-allowlisted users hit 403; unauthenticated
requests hit 401.

WHAT EACH PERSONA CANNOT DO
═══════════════════════════
  ✗ Customer admin can't see /admin/* (those are platform-admin only).
  ✗ Customer admin can't pair a device — pairing is tied to one
    individual user; the admin pairs their OWN device if they want to
    also be a producer.
  ✗ Producer can't manage members / invite teammates / grant access
    to consumers — that's tenant_admin only.
  ✗ Producer can't archive / restore projects — tenant_admin only.
  ✗ Producer can't see other tenants' projects, attestations, or audit.
  ✗ Consumer can't see ANY tenant pages — they have zero memberships
    and no personal tenant. Their home is the granted-attestations
    list (/me/attestation-access).
  ✗ Consumer can't lookup against attestations they weren't granted
    (private). They CAN lookup against public projects' attestations,
    but the customer-admin tenant created a Private project for this
    walkthrough so that path is gated.

GOTCHAS WORTH KNOWING
═════════════════════
  • Walkthrough seed data is wiped by the integration test suite — if
    you run \`pnpm turbo run test\` between sign-ins, you'll be logged
    out and the accounts will be gone. Re-run this script to re-seed.
  • Free tenants cap at 1 user, 5 projects, 1 attestation per project,
    100 MB single submission, 6 lookups/min. Anything you do on a
    fresh personal tenant will trip those caps fast.
  • The desktop's "Resume a draft" panel persists across app restarts
    (encrypted via OS Keychain). "Sign out of profile" wipes the
    drafts + processing cache; pairing later starts fresh.
`);

  log('═'.repeat(70));
  log('✓ READY — open the portal and start at PART 1.');
  log('═'.repeat(70));
  process.exit(0);
};

main().catch((err) => {
  console.error('\nwalkthrough crashed:', err);
  process.exit(1);
});
