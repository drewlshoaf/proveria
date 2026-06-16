// Unit tests for the real attestation validation handler (M4/C14, M5/C16).
//
// Each test seeds a tenant + user + project + paired device + attestation +
// uploaded attempt against the real Postgres, builds a *real* signed manifest
// with @proveria/manifest + @proveria/crypto-core, hands it to validateAttempt
// via a fake fetchManifest + a capturing putObject, and asserts the resulting
// row states *and* the immutable artifacts written to the object store.

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
  submissionAttempts,
  webhookDeliveries,
  type ClientHandle,
} from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';

import { validateAttempt } from './attestation-validation.js';

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
  devicePrivateKey: string;
  devicePublicKey: string;
}

/** Seed a full chain of rows and return the ids + the device keypair. */
const seedFixture = async (opts?: {
  revokeDevice?: boolean;
  apiOrigin?: boolean;
}): Promise<Fixture> => {
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
  const [device] = opts?.apiOrigin
    ? [undefined]
    : await handle.sql<{ id: string }[]>`
    INSERT INTO public.devices (tenant_id, user_id, profile_id, public_key, name, platform, app_version, revoked_at)
    VALUES (${tenant!.id}, ${user!.id}, gen_random_uuid(), ${kp.publicKey}, 'd', 'darwin', '0.0.0',
            ${opts?.revokeDevice ? new Date().toISOString() : null})
    RETURNING id`;
  const [attestation] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.attestations (tenant_id, project_id, label, created_by_user_id, created_by_device_id, state)
    VALUES (${tenant!.id}, ${project!.id}, ${'label-' + suffix}, ${user!.id}, ${device?.id ?? null}, 'uploaded')
    RETURNING id`;
  const [attempt] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.submission_attempts (attestation_id, state, manifest_object_key, uploaded_at)
    VALUES (${attestation!.id}, 'uploaded', ${'tenants/' + tenant!.id + '/manifest.json'}, now())
    RETURNING id`;

  return {
    tenantId: tenant!.id,
    projectId: project!.id,
    userId: user!.id,
    deviceId: device?.id ?? 'proveria-public-api',
    attestationId: attestation!.id,
    attemptId: attempt!.id,
    devicePrivateKey: kp.privateKey,
    devicePublicKey: kp.publicKey,
  };
};

const buildApiManifest = (f: Fixture): Manifest =>
  buildManifest({
    tenantId: f.tenantId,
    projectId: f.projectId,
    attestationId: f.attestationId,
    attemptId: f.attemptId,
    createdByUserId: f.userId,
    createdByDeviceId: 'proveria-public-api',
    createdByProfileId: 'public-api',
    leaves: [
      { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
    ],
    policyContext: { submission_channel: 'public_api' },
    sourceSummary: { file_count: 1, shingle_count: 0, ocr_page_count: 0 },
  });

/** Build a real signed manifest for a fixture, with optional field overrides. */
const buildSignedManifest = async (
  f: Fixture,
  overrides?: Partial<Manifest>,
): Promise<Manifest> => {
  const manifest = buildManifest({
    tenantId: f.tenantId,
    projectId: f.projectId,
    attestationId: f.attestationId,
    attemptId: f.attemptId,
    createdByUserId: f.userId,
    createdByDeviceId: f.deviceId,
    createdByProfileId: '66666666-6666-6666-6666-666666666666',
    leaves: [
      { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
      { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(2) },
    ],
    sourceSummary: { file_count: 2, shingle_count: 0, ocr_page_count: 0 },
  });
  const withOverrides = { ...manifest, ...overrides };
  const { digest } = buildSigningDigest(
    withOverrides as unknown as Record<string, unknown>,
  );
  const signature = await signEd25519(digest, f.devicePrivateKey);
  return {
    ...withOverrides,
    signatures: [
      {
        signer_kind: 'device',
        key_id: f.deviceId,
        algorithm: 'ed25519',
        signature,
      },
    ],
  };
};

const fetchManifestFor =
  (text: string) =>
  async (): Promise<string> =>
    text;

// Capturing putObject — records every artifact write so tests can assert on
// the immutable object-store layout without standing up MinIO.
const putCalls = new Map<
  string,
  { body: string | Buffer | Uint8Array; contentType: string }
>();
const webhookJobs: string[] = [];
const capturePut = async (
  objectKey: string,
  body: string | Buffer | Uint8Array,
  contentType: string,
): Promise<void> => {
  putCalls.set(objectKey, { body, contentType });
};

/** Build the validateAttempt deps with a given manifest payload. */
const deps = (manifestText: string) => ({
  db: handle.db,
  fetchManifest: fetchManifestFor(manifestText),
  putObject: capturePut,
  enqueueWebhookDelivery: async (deliveryId: string) => {
    webhookJobs.push(deliveryId);
  },
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
  webhookJobs.length = 0;
});

describe('validateAttempt — happy path', () => {
  it('confirms an attestation with a valid signed manifest', async () => {
    const f = await seedFixture();
    const manifest = await buildSignedManifest(f);
    const result = await validateAttempt(
      deps(JSON.stringify(manifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(true);
    expect(result.state).toBe('validated');

    const [att] = await handle.db
      .select()
      .from(attestations)
      .where(eq(attestations.id, f.attestationId));
    expect(att?.state).toBe('confirmed');
    expect(att?.confirmedAttemptId).toBe(f.attemptId);
    expect(att?.merkleRoot).toBe(manifest.merkle_root);

    const [attempt] = await handle.db
      .select()
      .from(submissionAttempts)
      .where(eq(submissionAttempts.id, f.attemptId));
    expect(attempt?.state).toBe('validated');

    const leavesKey = `tenants/${f.tenantId}/leaves.jsonl`;
    const resultKey = `tenants/${f.tenantId}/validation-result.json`;
    expect(attempt?.leavesObjectKey).toBe(leavesKey);
    expect(attempt?.validationResultObjectKey).toBe(resultKey);
    expect(att?.leavesObjectKey).toBe(leavesKey);

    // Immutable artifacts were written to the attempt's object-store prefix.
    const leaves = putCalls.get(leavesKey);
    expect(leaves?.contentType).toBe('application/x-ndjson');
    expect((leaves!.body as string).trim().split('\n')).toHaveLength(2);
    const vr = putCalls.get(resultKey);
    expect(vr?.contentType).toBe('application/json');
    const vrDoc = JSON.parse(vr!.body as string) as {
      outcome: string;
      merkle_root: string;
    };
    expect(vrDoc.outcome).toBe('validated');
    expect(vrDoc.merkle_root).toBe(manifest.merkle_root);
  });

  it('confirms an API-origin attestation with an unsigned manifest', async () => {
    const f = await seedFixture({ apiOrigin: true });
    const manifest = buildApiManifest(f);

    const result = await validateAttempt(
      deps(JSON.stringify(manifest)),
      f.attemptId,
    );

    expect(result.ok).toBe(true);
    const [att] = await handle.db
      .select()
      .from(attestations)
      .where(eq(attestations.id, f.attestationId));
    expect(att?.state).toBe('confirmed');
    expect(att?.createdByDeviceId).toBeNull();
    expect(att?.merkleRoot).toBe(manifest.merkle_root);
  });

  it('records and enqueues attestation.confirmed webhook deliveries', async () => {
    const f = await seedFixture();
    const [endpoint] = await handle.sql<{ id: string }[]>`
      INSERT INTO public.webhook_endpoints
        (tenant_id, url, events, signing_secret, created_by_user_id)
      VALUES
        (${f.tenantId}, 'https://example.com/webhooks',
         ${JSON.stringify(['attestation.confirmed'])}::jsonb, 'whsec_test', ${f.userId})
      RETURNING id`;
    const manifest = await buildSignedManifest(f);

    const result = await validateAttempt(
      deps(JSON.stringify(manifest)),
      f.attemptId,
    );

    expect(result.ok).toBe(true);
    const deliveries = await handle.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint!.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.eventType).toBe('attestation.confirmed');
    expect(webhookJobs).toEqual([deliveries[0]?.id]);
  });
});

describe('validateAttempt — manifest integrity failures', () => {
  it('fails when the manifest JSON is invalid', async () => {
    const f = await seedFixture();
    const [endpoint] = await handle.sql<{ id: string }[]>`
      INSERT INTO public.webhook_endpoints
        (tenant_id, url, events, signing_secret, created_by_user_id)
      VALUES
        (${f.tenantId}, 'https://example.com/webhooks',
         ${JSON.stringify(['attestation.failed'])}::jsonb, 'whsec_test', ${f.userId})
      RETURNING id`;
    const result = await validateAttempt(
      deps('{not json'),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/manifest_json_invalid/);
    const [att] = await handle.db
      .select()
      .from(attestations)
      .where(eq(attestations.id, f.attestationId));
    expect(att?.state).toBe('failed_needs_review');

    // Failed attempts still retain a validation-result.json (§7.3, §11.4).
    const resultKey = `tenants/${f.tenantId}/validation-result.json`;
    const vr = putCalls.get(resultKey);
    expect(vr).toBeDefined();
    const vrDoc = JSON.parse(vr!.body as string) as {
      outcome: string;
      error: string;
    };
    expect(vrDoc.outcome).toBe('failed');
    expect(vrDoc.error).toMatch(/manifest_json_invalid/);
    const [attempt] = await handle.db
      .select()
      .from(submissionAttempts)
      .where(eq(submissionAttempts.id, f.attemptId));
    expect(attempt?.validationResultObjectKey).toBe(resultKey);

    const deliveries = await handle.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint!.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.eventType).toBe('attestation.failed');
    expect(webhookJobs).toEqual([deliveries[0]?.id]);
  });

  it('fails when merkle_root was tampered with', async () => {
    const f = await seedFixture();
    const manifest = await buildSignedManifest(f);
    const tampered = {
      ...manifest,
      merkle_root:
        '0000000000000000000000000000000000000000000000000000000000000000',
    };
    const result = await validateAttempt(
      deps(JSON.stringify(tampered)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/manifest_invalid/);
  });
});

describe('validateAttempt — id cross-checks', () => {
  it('fails when the manifest claims a different attestation_id', async () => {
    const f = await seedFixture();
    const manifest = await buildSignedManifest(f, {
      attestation_id: '99999999-9999-9999-9999-999999999999',
    });
    const result = await validateAttempt(
      deps(JSON.stringify(manifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/manifest_attestation_id_mismatch/);
  });

  it('fails when the manifest claims a different device', async () => {
    const f = await seedFixture();
    const manifest = await buildSignedManifest(f, {
      created_by_device_id: '88888888-8888-8888-8888-888888888888',
    });
    const result = await validateAttempt(
      deps(JSON.stringify(manifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/manifest_created_by_device_id_mismatch/);
  });
});

describe('validateAttempt — signature failures', () => {
  it('fails when the signature is from a different key', async () => {
    const f = await seedFixture();
    const other = await generateEd25519Keypair();
    const manifest = buildManifest({
      tenantId: f.tenantId,
      projectId: f.projectId,
      attestationId: f.attestationId,
      attemptId: f.attemptId,
      createdByUserId: f.userId,
      createdByDeviceId: f.deviceId,
      createdByProfileId: '66666666-6666-6666-6666-666666666666',
      leaves: [
        {
          leafType: LEAF_TYPES.fileSha256V1,
          canonicalPayloadHash: payloadHash(1),
        },
      ],
      sourceSummary: { file_count: 1, shingle_count: 0, ocr_page_count: 0 },
    });
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    const wrongSig = await signEd25519(digest, other.privateKey);
    const badManifest = {
      ...manifest,
      signatures: [
        {
          signer_kind: 'device' as const,
          key_id: f.deviceId,
          algorithm: 'ed25519' as const,
          signature: wrongSig,
        },
      ],
    };
    const result = await validateAttempt(
      deps(JSON.stringify(badManifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('device_signature_invalid');
  });

  it('fails when the device signature key_id does not match the resolved device', async () => {
    const f = await seedFixture();
    const manifest = await buildSignedManifest(f);
    const badManifest: Manifest = {
      ...manifest,
      signatures: manifest.signatures.map((sig) =>
        sig.signer_kind === 'device'
          ? { ...sig, key_id: '99999999-9999-9999-9999-999999999999' }
          : sig,
      ),
    };
    const result = await validateAttempt(
      deps(JSON.stringify(badManifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('device_signature_invalid');
  });

  it('fails when the signing device has been revoked', async () => {
    const f = await seedFixture({ revokeDevice: true });
    const manifest = await buildSignedManifest(f);
    const result = await validateAttempt(
      deps(JSON.stringify(manifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('device_revoked');
  });

  it('fails when the manifest body was altered after signing', async () => {
    const f = await seedFixture();
    const manifest = await buildSignedManifest(f);
    // Tamper a non-id, non-merkle field after signing — structural validation
    // still passes, but the signature no longer matches.
    const tampered = { ...manifest, created_at: '2099-01-01T00:00:00Z' };
    const result = await validateAttempt(
      deps(JSON.stringify(tampered)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('device_signature_invalid');
  });
});

describe('validateAttempt — shingling plan gate (M10/C38)', () => {
  it('rejects shingle leaves on a Free tenant', async () => {
    // seedFixture defaults to plan='free'. Build a manifest with one file
    // leaf AND one shingle leaf; validateAttempt must fail closed.
    const f = await seedFixture();
    const manifest = buildManifest({
      tenantId: f.tenantId,
      projectId: f.projectId,
      attestationId: f.attestationId,
      attemptId: f.attemptId,
      createdByUserId: f.userId,
      createdByDeviceId: f.deviceId,
      createdByProfileId: '66666666-6666-6666-6666-666666666666',
      leaves: [
        { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
        { leafType: LEAF_TYPES.shingleSha256V1, canonicalPayloadHash: payloadHash(2) },
      ],
      shinglingVersion: '1.0',
      sourceSummary: { file_count: 1, shingle_count: 1, ocr_page_count: 0 },
    });
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    const signature = await signEd25519(digest, f.devicePrivateKey);
    const signedManifest: Manifest = {
      ...manifest,
      signatures: [
        {
          signer_kind: 'device',
          key_id: f.deviceId,
          algorithm: 'ed25519',
          signature,
        },
      ],
    };
    const result = await validateAttempt(
      deps(JSON.stringify(signedManifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('shingling_not_in_plan:free');
  });

  it('accepts shingle leaves on a paid tenant', async () => {
    const f = await seedFixture();
    // Upgrade this tenant to team_pro.
    await handle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${f.tenantId}`;
    const manifest = buildManifest({
      tenantId: f.tenantId,
      projectId: f.projectId,
      attestationId: f.attestationId,
      attemptId: f.attemptId,
      createdByUserId: f.userId,
      createdByDeviceId: f.deviceId,
      createdByProfileId: '66666666-6666-6666-6666-666666666666',
      leaves: [
        { leafType: LEAF_TYPES.fileSha256V1, canonicalPayloadHash: payloadHash(1) },
        { leafType: LEAF_TYPES.shingleSha256V1, canonicalPayloadHash: payloadHash(2) },
      ],
      shinglingVersion: '1.0',
      sourceSummary: { file_count: 1, shingle_count: 1, ocr_page_count: 0 },
    });
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    const signature = await signEd25519(digest, f.devicePrivateKey);
    const signedManifest: Manifest = {
      ...manifest,
      signatures: [
        {
          signer_kind: 'device',
          key_id: f.deviceId,
          algorithm: 'ed25519',
          signature,
        },
      ],
    };
    const result = await validateAttempt(
      deps(JSON.stringify(signedManifest)),
      f.attemptId,
    );
    expect(result.ok).toBe(true);
  });
});
