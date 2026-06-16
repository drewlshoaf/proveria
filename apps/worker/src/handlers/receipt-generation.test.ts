// Unit tests for the receipt-generation handler (M5/C18).
//
// Seeds a *confirmed* attestation + validated attempt against the real
// Postgres, builds a real signed manifest, runs generateReceipt with a fake
// fetchManifest + a capturing putObject and asserts the receipt artifact + the
// attestation row wiring.

import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import {
  attestations,
  createClient,
  type ClientHandle,
} from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';
import type { AttestationReceipt } from '@proveria/receipt';

import { generateReceipt } from './receipt-generation.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let handle: ClientHandle;

const truncateAll = async (): Promise<void> => {
  await handle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_events,
      public.webhook_deliveries,
      public.webhook_endpoints,
      public.submission_attempts,
      public.attestations,
      public.projects,
      public.tenant_invitations,
      public.password_reset_tokens,
      public.email_verification_tokens,
      public.device_pairing_attempts,
      public.devices,
      public.sessions,
      public.tenant_memberships,
      public.tenants,
      public.users
    RESTART IDENTITY CASCADE
  `);
};

const payloadHash = (n: number): Uint8Array => {
  const b = new Uint8Array(32);
  b[31] = n;
  return b;
};

interface Fixture {
  tenantId: string;
  projectId: string;
  userId: string;
  deviceId: string;
  attestationId: string;
  attemptId: string;
  manifestObjectKey: string;
  manifest: Manifest;
}

/** Seed a confirmed attestation + validated attempt and its signed manifest. */
const seedConfirmed = async (
  opts: {
    leaves?: Parameters<typeof buildManifest>[0]['leaves'];
    sourceSummary?: Parameters<typeof buildManifest>[0]['sourceSummary'];
    publicApiUnsigned?: boolean;
  } = {},
): Promise<Fixture> => {
  const kp = await generateEd25519Keypair();
  const suffix = Math.random().toString(16).slice(2, 8);

  const [tenant] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.tenants (name, slug, plan, is_personal)
    VALUES ('T', ${'t-' + suffix}, 'free', true) RETURNING id`;
  const [user] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.users (email, password_hash)
    VALUES (${suffix + '@example.com'},
            '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$3RnvgQDmd7l5d3pBQQiB1MnrYNRBhWoOd9SPbnNyqIQ')
    RETURNING id`;
  const [project] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.projects (tenant_id, slug, name, template_slug, visibility, created_by_user_id)
    VALUES (${tenant!.id}, ${'p-' + suffix}, 'P', 'general_provenance', 'public', ${user!.id})
    RETURNING id`;
  const [device] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.devices (tenant_id, user_id, profile_id, public_key, name, platform, app_version)
    VALUES (${tenant!.id}, ${user!.id}, gen_random_uuid(), ${kp.publicKey}, 'd', 'darwin', '0.0.0')
    RETURNING id`;
  const [attestation] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.attestations (tenant_id, project_id, label, created_by_user_id, created_by_device_id, state)
    VALUES (${tenant!.id}, ${project!.id}, ${'label-' + suffix}, ${user!.id}, ${device!.id}, 'confirmed')
    RETURNING id`;
  const manifestObjectKey =
    'tenants/' + tenant!.id + '/attempts/x/manifest.json';
  const [attempt] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.submission_attempts (attestation_id, state, manifest_object_key, uploaded_at, validated_at)
    VALUES (${attestation!.id}, 'validated', ${manifestObjectKey}, now(), now())
    RETURNING id`;

  // The attestation points at the confirmed attempt.
  await handle.sql`
    UPDATE public.attestations
    SET confirmed_attempt_id = ${attempt!.id},
        confirmed_at = now(),
        manifest_object_key = ${manifestObjectKey}
    WHERE id = ${attestation!.id}`;

  const base = buildManifest({
    tenantId: tenant!.id,
    projectId: project!.id,
    attestationId: attestation!.id,
    attemptId: attempt!.id,
    createdByUserId: user!.id,
    createdByDeviceId: device!.id,
    createdByProfileId: '66666666-6666-6666-6666-666666666666',
    leaves: opts.leaves ?? [
      { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
      { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(2) },
    ],
    sourceSummary:
      opts.sourceSummary ?? { file_count: 2, shingle_count: 0, ocr_page_count: 0 },
    policyContext: opts.publicApiUnsigned
      ? { submission_channel: 'public_api' }
      : undefined,
  });
  const { digest } = buildSigningDigest(
    base as unknown as Record<string, unknown>,
  );
  const signature = await signEd25519(digest, kp.privateKey);
  const manifest: Manifest = {
    ...base,
    signatures: opts.publicApiUnsigned
      ? []
      : [
          {
            signer_kind: 'device',
            key_id: device!.id,
            algorithm: 'ed25519',
            signature,
          },
        ],
  };

  return {
    tenantId: tenant!.id,
    projectId: project!.id,
    userId: user!.id,
    deviceId: device!.id,
    attestationId: attestation!.id,
    attemptId: attempt!.id,
    manifestObjectKey,
    manifest,
  };
};

const putCalls = new Map<
  string,
  { body: string | Buffer | Uint8Array; contentType: string }
>();
const capturePut = async (
  objectKey: string,
  body: string | Buffer | Uint8Array,
  contentType: string,
): Promise<void> => {
  putCalls.set(objectKey, { body, contentType });
};

const deps = (f: Fixture) => ({
  db: handle.db,
  fetchManifest: async (): Promise<string> => JSON.stringify(f.manifest),
  putObject: capturePut,
});

beforeAll(async () => {
  handle = createClient({ url: DATABASE_URL, max: 3 });
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll();
  putCalls.clear();
});

describe('generateReceipt', () => {
  it('writes a receipt and wires the attestation row', async () => {
    const f = await seedConfirmed();
    const [endpoint] = await handle.sql<{ id: string }[]>`
      INSERT INTO public.webhook_endpoints
        (tenant_id, url, events, signing_secret, created_by_user_id)
      VALUES
        (${f.tenantId}, 'https://example.com/webhooks',
         ${JSON.stringify(['receipt.issued'])}::jsonb, 'whsec_test', ${f.userId})
      RETURNING id`;
    const result = await generateReceipt(deps(f), f.attestationId, f.attemptId);

    expect(result.ok).toBe(true);
    expect(result.packageId).toMatch(/^pkg_[0-9a-f]{32}$/);

    const receiptKey = 'tenants/' + f.tenantId + '/attempts/x/receipt.json';
    const written = putCalls.get(receiptKey);
    expect(written?.contentType).toBe('application/json');

    const receipt = JSON.parse(written!.body as string) as AttestationReceipt;
    expect(receipt.receipt_type).toBe('attestation');
    expect(receipt.package_id).toBe(result.packageId);
    expect(receipt.attestation_id).toBe(f.attestationId);
    expect(receipt.merkle_root).toBe(f.manifest.merkle_root);
    expect(receipt.leaf_counts).toEqual({ file: 2, shingle: 0, component: 0 });
    expect(receipt.component_methods).toEqual([]);
    expect(receipt.device_signature.key_id).toBe(f.deviceId);
    expect(receipt.device_signature.verified).toBe(true);

    expect(receipt.signatures).toEqual([]);

    const [att] = await handle.db
      .select()
      .from(attestations)
      .where(eq(attestations.id, f.attestationId));
    expect(att?.packageId).toBe(result.packageId);
    expect(att?.receiptJsonObjectKey).toBe(receiptKey);

    const deliveries = await handle.sql<
      Array<{ endpoint_id: string; event_type: string; signature: string }>
    >`
      SELECT endpoint_id, event_type, signature
      FROM public.webhook_deliveries
      WHERE tenant_id = ${f.tenantId}`;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.endpoint_id).toBe(endpoint!.id);
    expect(deliveries[0]?.event_type).toBe('receipt.issued');
    expect(deliveries[0]?.signature).toMatch(/^t=.+,v1=[0-9a-f]{64}$/);
  });

  it('carries exact image component methods into receipts', async () => {
    const f = await seedConfirmed({
      leaves: [
        {
          leafType: LEAF_TYPES.fileSha256V1,
          canonicalPayloadHash: payloadHash(1),
        },
        {
          leafType: LEAF_TYPES.componentSha256V1,
          canonicalPayloadHash: payloadHash(1),
          metadata: {
            component_method: 'exact-image-sha256/v1',
            media_type: 'image/png',
          },
        },
      ],
      sourceSummary: {
        file_count: 1,
        shingle_count: 0,
        component_count: 1,
        ocr_page_count: 0,
      },
    });
    const result = await generateReceipt(deps(f), f.attestationId, f.attemptId);

    expect(result.ok).toBe(true);
    const receiptKey = 'tenants/' + f.tenantId + '/attempts/x/receipt.json';
    const receipt = JSON.parse(
      putCalls.get(receiptKey)!.body as string,
    ) as AttestationReceipt;
    expect(receipt.leaf_counts).toEqual({ file: 1, shingle: 0, component: 1 });
    expect(receipt.component_methods).toEqual(['exact-image-sha256/v1']);
  });

  it('issues receipts for unsigned public API manifests without claiming device verification', async () => {
    const f = await seedConfirmed({ publicApiUnsigned: true });
    const result = await generateReceipt(deps(f), f.attestationId, f.attemptId);

    expect(result.ok).toBe(true);
    const receiptKey = 'tenants/' + f.tenantId + '/attempts/x/receipt.json';
    const receipt = JSON.parse(
      putCalls.get(receiptKey)!.body as string,
    ) as AttestationReceipt;
    expect(receipt.device_signature).toEqual({
      key_id: 'public-api-unsigned-manifest',
      algorithm: 'ed25519',
      verified: false,
    });
  });

  it('binds the receipt to the manifest canonical digest', async () => {
    const f = await seedConfirmed();
    await generateReceipt(deps(f), f.attestationId, f.attemptId);
    const receiptKey = 'tenants/' + f.tenantId + '/attempts/x/receipt.json';
    const receipt = JSON.parse(
      putCalls.get(receiptKey)!.body as string,
    ) as AttestationReceipt;

    const { digest } = buildSigningDigest(
      f.manifest as unknown as Record<string, unknown>,
    );
    expect(receipt.manifest_canonical_sha256).toBe(
      Buffer.from(digest).toString('hex'),
    );
  });

  it('is idempotent — a second run returns the existing package id', async () => {
    const f = await seedConfirmed();
    const first = await generateReceipt(deps(f), f.attestationId, f.attemptId);
    putCalls.clear();
    const second = await generateReceipt(deps(f), f.attestationId, f.attemptId);

    expect(second.ok).toBe(true);
    expect(second.packageId).toBe(first.packageId);
    // No new artifact written on the idempotent re-run.
    expect(putCalls.size).toBe(0);
  });

  it('refuses to issue a receipt for an unconfirmed attestation', async () => {
    const f = await seedConfirmed();
    await handle.sql`
      UPDATE public.attestations SET state = 'failed_needs_review'
      WHERE id = ${f.attestationId}`;
    const result = await generateReceipt(deps(f), f.attestationId, f.attemptId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/attestation_not_confirmed/);
  });
});
