// Attestation routes.
//
// Device-signed (X-Proveria-* headers, verified against the paired device's
// stored Ed25519 public key):
//   POST /tenants/:slug/projects/:projectSlug/attestations
//   POST /attestations/:id/attempts/:attemptId/upload-manifest
//   POST /attestations/:id/attempts/:attemptId/finalize
//
// Session-authenticated read:
//   GET  /tenants/:slug/projects/:projectSlug/attestations
//   GET  /attestations/:id
//
// All device-signed routes also require the device to be paired to the same
// tenant + project the URL targets. State machine for C10 is the thin slice
// of docs/v1 §11.3:
//   pending → uploaded → validating → confirmed | failed_needs_review

import { randomBytes } from 'node:crypto';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import {
  buildMerkleProof,
  computeLeafHash,
  isLeafType,
  type LeafType,
} from '@proveria/crypto-core';
import {
  attestationAccessGrants,
  attestationAccessRequests,
  attestations,
  projects,
  submissionAttempts,
  tenantMemberships,
  tenants,
  users,
  verificationLinks,
  verificationResults,
  type DrizzleClient,
  type User,
} from '@proveria/db';
import type { Manifest } from '@proveria/manifest';
import {
  buildMatchResultPackage,
  buildNoMatchResultPackage,
  type ResultPackage,
} from '@proveria/proofs';
import type { AttestationReceipt } from '@proveria/receipt';

import { writeAuditEvent } from '../audit/writer.js';
import { requireDeviceSignatureFactory } from '../auth/device-signature.js';
import { requireSessionFactory } from '../auth/session-hook.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import {
  checkAttestationsPerProjectLimit,
  checkMonthlyAttestationLimit,
  checkStorageLimit,
  limitsFor,
} from '../entitlements/limits.js';
import {
  findActiveLinkForTarget,
  issueVerificationLink,
} from '../links/util.js';
import {
  getJsonText,
  lookupResultKey,
  manifestKey,
  putJson,
} from '../objects/client.js';
import type { NotificationProvider } from '../notifications/provider.js';
import {
  enqueueAttestationValidation,
  enqueuePdfRendering,
} from '../queues/producer.js';
import { resolveTenantContext } from '../tenants/resolver.js';

export interface AttestationPluginOptions {
  db: DrizzleClient;
  /**
   * Redis is optional so unit tests can register the plugin without a live
   * connection. The lookup rate-limit (M13/C51) becomes a no-op when null,
   * which is fine for tests that aren't exercising rate-limit behavior.
   */
  rateLimitRedis?: RateLimitRedis | null;
  /**
   * Notification sink used when a tenant admin grants access to an email
   * that doesn't yet have an account — the dev sink logs the grant token
   * so it can be redeemed via /register?grant=<token>. Optional so unit
   * tests that don't exercise the grant path can omit it.
   */
  notifications?: NotificationProvider | null;
}

/** Narrow shape of the Redis client the rate-limit path uses. */
export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.\-]{0,127}$/;
const MANIFEST_UPLOAD_BODY_LIMIT_BYTES = 256 * 1024 * 1024;

interface AttestationCoverageSummary {
  coverageType: string;
  shinglingPresets: string[];
  extractionMethods: string[];
}

interface GoogleDriveSourceMetadata {
  [key: string]: unknown;
  provider: 'google_drive';
  fileId: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  modifiedTime?: string;
  selectedByUserId: string;
  selectedAt: string;
  googleAccountEmail?: string;
}

type AttestationSourceMetadata = GoogleDriveSourceMetadata;

const sourceMetadataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'fileId', 'fileName'],
  properties: {
    provider: { const: 'google_drive' },
    fileId: { type: 'string', minLength: 1, maxLength: 512 },
    fileName: { type: 'string', minLength: 1, maxLength: 512 },
    mimeType: { type: 'string', minLength: 1, maxLength: 255 },
    size: { type: 'integer', minimum: 0 },
    modifiedTime: { type: 'string', maxLength: 80 },
    googleAccountEmail: { type: 'string', minLength: 3, maxLength: 320 },
  },
} as const;

const sourceMetadataFromBody = (
  value: unknown,
  selectedByUserId: string,
): AttestationSourceMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as {
    provider?: unknown;
    fileId?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
    size?: unknown;
    modifiedTime?: unknown;
    googleAccountEmail?: unknown;
  };
  if (
    raw.provider !== 'google_drive' ||
    typeof raw.fileId !== 'string' ||
    typeof raw.fileName !== 'string'
  ) {
    return null;
  }
  return {
    provider: 'google_drive',
    fileId: raw.fileId,
    fileName: raw.fileName,
    ...(typeof raw.mimeType === 'string' ? { mimeType: raw.mimeType } : {}),
    ...(typeof raw.size === 'number' && Number.isInteger(raw.size)
      ? { size: raw.size }
      : {}),
    ...(typeof raw.modifiedTime === 'string'
      ? { modifiedTime: raw.modifiedTime }
      : {}),
    selectedByUserId,
    selectedAt: new Date().toISOString(),
    ...(typeof raw.googleAccountEmail === 'string'
      ? { googleAccountEmail: raw.googleAccountEmail.toLowerCase() }
      : {}),
  };
};

const publicSourceMetadata = (
  value: Record<string, unknown> | null | undefined,
): AttestationSourceMetadata | null => {
  if (!value || value.provider !== 'google_drive') return null;
  if (typeof value.fileId !== 'string' || typeof value.fileName !== 'string') {
    return null;
  }
  return {
    provider: 'google_drive',
    fileId: value.fileId,
    fileName: value.fileName,
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
    ...(typeof value.size === 'number' && Number.isInteger(value.size)
      ? { size: value.size }
      : {}),
    ...(typeof value.modifiedTime === 'string'
      ? { modifiedTime: value.modifiedTime }
      : {}),
    ...(typeof value.selectedByUserId === 'string'
      ? { selectedByUserId: value.selectedByUserId }
      : { selectedByUserId: '' }),
    ...(typeof value.selectedAt === 'string'
      ? { selectedAt: value.selectedAt }
      : { selectedAt: '' }),
    ...(typeof value.googleAccountEmail === 'string'
      ? { googleAccountEmail: value.googleAccountEmail }
      : {}),
  };
};

const summarizeAttestationCoverage = async (
  manifestObjectKey: string | null,
): Promise<AttestationCoverageSummary> => {
  let coverageType = 'whole-file';
  const shinglingPresets = new Set<string>();
  const extractionMethods = new Set<string>();
  if (!manifestObjectKey) {
    return {
      coverageType,
      shinglingPresets: [],
      extractionMethods: [],
    };
  }

  try {
    const manifestText = await getJsonText(manifestObjectKey);
    const manifest = JSON.parse(manifestText) as Manifest;
    let hasFile = false;
    let hasNativeShingle = false;
    let hasOcrShingle = false;
    let hasExactImageProof = false;
    for (const leaf of manifest.leaf_set) {
      if (leaf.leaf_type === 'file/sha256/v1') hasFile = true;
      if (leaf.leaf_type === 'shingle/sha256/v1') {
        const md = leaf.metadata as {
          preset?: unknown;
          source_extraction_method?: unknown;
        };
        if (typeof md.preset === 'string') shinglingPresets.add(md.preset);
        const method = md.source_extraction_method;
        if (typeof method === 'string') {
          extractionMethods.add(method);
          if (method === 'ocr-tesseract/v1') hasOcrShingle = true;
          else hasNativeShingle = true;
        }
      }
      if (leaf.leaf_type === 'component/sha256/v1') {
        const md = leaf.metadata as { component_method?: unknown };
        if (md.component_method === 'exact-image-sha256/v1') {
          hasExactImageProof = true;
        }
      }
    }
    const shinglePart =
      hasNativeShingle && hasOcrShingle
        ? 'native text + ocr shingles'
        : hasOcrShingle
          ? 'ocr-derived shingles'
          : hasNativeShingle
            ? 'native text shingles'
            : null;
    const coverageParts = [
      ...(hasFile ? ['whole-file'] : []),
      ...(shinglePart ? [shinglePart] : []),
      ...(hasExactImageProof ? ['exact image proof'] : []),
    ];
    if (coverageParts.length > 0) {
      coverageType = coverageParts.join(' + ');
    }
  } catch {
    // Best-effort metadata; callers can still show the default whole-file view.
  }

  return {
    coverageType,
    shinglingPresets: [...shinglingPresets].sort(),
    extractionMethods: [...extractionMethods].sort(),
  };
};

export const attestationPlugin: FastifyPluginAsync<
  AttestationPluginOptions
> = async (app, opts) => {
  const { db } = opts;
  const rateLimitRedis = opts.rateLimitRedis ?? null;
  const notifications = opts.notifications ?? null;
  const requireSession = requireSessionFactory(db);
  const requireDeviceSignature = requireDeviceSignatureFactory(db);

  const requireSessionOrDevice: import('fastify').preHandlerAsyncHookHandler =
    async (req, reply) => {
      if (typeof req.headers['x-proveria-device-id'] === 'string') {
        await requireDeviceSignature.call(app, req, reply);
        return;
      }
      await requireSession.call(app, req, reply);
    };

  const hasTenantReadAccess = async (
    req: import('fastify').FastifyRequest,
    tenantId: string,
  ): Promise<boolean> => {
    if (req.currentDevice) {
      if (req.currentDeviceTenant?.id !== tenantId) return false;
      const [membership] = await db
        .select({ role: tenantMemberships.role })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, req.currentDeviceUser!.id),
          ),
        )
        .limit(1);
      return Boolean(membership);
    }

    const user = req.currentUser as User;
    const [membership] = await db
      .select({ role: tenantMemberships.role })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, user.id),
        ),
      )
      .limit(1);
    return Boolean(membership);
  };

  const resolveRequestTenantContext = async (
    req: import('fastify').FastifyRequest,
    slug: string,
  ): Promise<
    | {
        tenant: typeof tenants.$inferSelect;
        membership: typeof tenantMemberships.$inferSelect;
        user: User;
      }
    | null
  > => {
    if (req.currentDevice) {
      const tenant = req.currentDeviceTenant!;
      if (tenant.slug !== slug) return null;
      const [membership] = await db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, tenant.id),
            eq(tenantMemberships.userId, req.currentDeviceUser!.id),
          ),
        )
        .limit(1);
      if (!membership) return null;
      return { tenant, membership, user: req.currentDeviceUser! };
    }
    const user = req.currentUser as User;
    const ctx = await resolveTenantContext(db, user, slug);
    return ctx ? { ...ctx, user } : null;
  };

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/projects/:projectSlug/attestations  (device-signed)
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string; projectSlug: string } }>(
    '/tenants/:slug/projects/:projectSlug/attestations',
    {
      preHandler: requireDeviceSignature,
      schema: {
        body: {
          type: 'object',
          required: ['label'],
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 128 },
            description: { type: 'string', maxLength: 2000 },
            sourceMetadata: sourceMetadataSchema,
          },
        },
      },
    },
    async (req, reply) => {
      const device = req.currentDevice!;
      const deviceTenant = req.currentDeviceTenant!;
      const deviceUser = req.currentDeviceUser!;

      // Tenant slug must match the device's tenant. Otherwise an attacker who
      // paired against tenant A could try to submit against tenant B.
      if (deviceTenant.slug !== req.params.slug) {
        return reply.code(404).send({ error: 'not_found' });
      }

      // Project must exist under that tenant.
      const projectRows = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.tenantId, deviceTenant.id),
            eq(projects.slug, req.params.projectSlug),
          ),
        )
        .limit(1);
      const project = projectRows[0];
      if (!project) return reply.code(404).send({ error: 'not_found' });
      if (project.archivedAt) {
        return reply.code(409).send({ error: 'project_archived' });
      }

      const body = req.body as {
        label: string;
        description?: string;
        sourceMetadata?: unknown;
      };
      if (!LABEL_RE.test(body.label)) {
        return reply.code(400).send({ error: 'invalid_label' });
      }
      const sourceMetadata = sourceMetadataFromBody(
        body.sourceMetadata,
        deviceUser.id,
      );

      // Label uniqueness within project (docs/v1 §11.2). Enforced by the
      // unique index too; we check here to return a clean 409.
      const existing = await db
        .select({ id: attestations.id })
        .from(attestations)
        .where(
          and(
            eq(attestations.projectId, project.id),
            eq(attestations.label, body.label),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return reply.code(409).send({ error: 'label_taken' });
      }

      // Per-project attestation cap (docs/v1 §22.2; Free = 1, paid = null).
      // Counts every existing attestation including failed/canceled because
      // repair under the existing attestation_id (§11.4) is the supported
      // retry path — burning a fresh row on every retry would defeat that.
      const perProjectCap = await checkAttestationsPerProjectLimit(
        db,
        project.id,
        deviceTenant.plan,
      );
      if (!perProjectCap.ok) {
        return reply.code(409).send({
          error: perProjectCap.error,
          limit: perProjectCap.limit,
          current: perProjectCap.current,
        });
      }

      // Monthly attestation allowance (§22.2; Team Starter 50, Team Pro 500).
      // Counts attestations.created_at within the current UTC calendar
      // month. Free/Enterprise are null at this layer.
      const monthlyCap = await checkMonthlyAttestationLimit(
        db,
        deviceTenant.id,
        deviceTenant.plan,
      );
      if (!monthlyCap.ok) {
        return reply.code(409).send({
          error: monthlyCap.error,
          limit: monthlyCap.limit,
          current: monthlyCap.current,
        });
      }

      const { attestation, attempt } = await db.transaction(async (tx) => {
        const attRows = await tx
          .insert(attestations)
          .values({
            tenantId: deviceTenant.id,
            projectId: project.id,
            label: body.label,
            description: body.description ?? null,
            createdByUserId: deviceUser.id,
            createdByDeviceId: device.id,
            state: 'pending',
          })
          .returning();
        const att = attRows[0];
        if (!att) throw new Error('failed to insert attestation');
        const attemptRows = await tx
          .insert(submissionAttempts)
          .values({
            attestationId: att.id,
            state: 'pending',
            sourceMetadata: sourceMetadata ?? {},
          })
          .returning();
        const attRow = attemptRows[0];
        if (!attRow) throw new Error('failed to insert attempt');
        return { attestation: att, attempt: attRow };
      });

      await writeAuditEvent(db, {
        tenantId: deviceTenant.id,
        actorUserId: deviceUser.id,
        actorDeviceId: device.id,
        category: AUDIT_CATEGORIES.attestationLifecycle,
        action: AUDIT_ACTIONS.attestationCreated,
        targetType: 'attestation',
        targetId: attestation.id,
        payload: {
          label: attestation.label,
          projectSlug: project.slug,
          ...(sourceMetadata ? { sourceProvider: sourceMetadata.provider } : {}),
        },
      });
      if (sourceMetadata?.provider === 'google_drive') {
        await writeAuditEvent(db, {
          tenantId: deviceTenant.id,
          actorUserId: deviceUser.id,
          actorDeviceId: device.id,
          category: AUDIT_CATEGORIES.attestationLifecycle,
          action: AUDIT_ACTIONS.attestationSourceGoogleDriveSubmitted,
          targetType: 'attestation',
          targetId: attestation.id,
          payload: {
            projectSlug: project.slug,
            fileId: sourceMetadata.fileId,
            fileName: sourceMetadata.fileName,
            mimeType: sourceMetadata.mimeType ?? null,
            googleAccountEmail: sourceMetadata.googleAccountEmail ?? null,
          },
        });
      }

      reply.code(201).send({
        attestation: {
          id: attestation.id,
          label: attestation.label,
          state: attestation.state,
          createdAt: attestation.createdAt.toISOString(),
        },
        attempt: {
          id: attempt.id,
          state: attempt.state,
        },
        // The desktop needs these ids to build the manifest (§7.1 fields).
        project: { id: project.id, slug: project.slug },
        tenant: { id: deviceTenant.id, slug: deviceTenant.slug },
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /attestations/:id/attempts/:attemptId/upload-manifest  (device-signed)
  // -----------------------------------------------------------------------
  // Body is the manifest JSON. Server hashes it (already done by the
  // signature middleware) and writes it to MinIO at the canonical prefix.
  app.post<{ Params: { id: string; attemptId: string } }>(
    '/attestations/:id/attempts/:attemptId/upload-manifest',
    {
      preHandler: requireDeviceSignature,
      bodyLimit: MANIFEST_UPLOAD_BODY_LIMIT_BYTES,
      schema: {
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (req, reply) => {
      const device = req.currentDevice!;
      const deviceTenant = req.currentDeviceTenant!;
      const { attestation, attempt } = await loadAttestationAttempt(
        db,
        req.params.id,
        req.params.attemptId,
      );
      if (!attestation || !attempt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (attestation.createdByDeviceId !== device.id) {
        return reply.code(403).send({ error: 'wrong_device' });
      }
      if (attempt.state !== 'pending') {
        return reply
          .code(409)
          .send({ error: 'attempt_not_pending', state: attempt.state });
      }

      // Plan storage cap (§22.2). We sum byte_size across file/sha256/v1
      // leaves in the incoming manifest and reject if that alone exceeds
      // the cap. V1 thin slice: this catches single-submission overruns
      // (e.g. a 30 GB upload on a 25 GB Team Starter plan); a follow-up
      // checkpoint will add cumulative across-attestation accounting.
      const incomingBytes = sumIncomingFileBytes(req.body);
      const storageCap = await checkStorageLimit(
        db,
        deviceTenant.id,
        deviceTenant.plan,
        incomingBytes,
      );
      if (!storageCap.ok) {
        return reply.code(413).send({
          error: storageCap.error,
          limit: storageCap.limit,
          current: storageCap.current,
        });
      }

      const key = manifestKey(
        attestation.tenantId,
        attestation.projectId,
        attestation.id,
        attempt.id,
      );
      await putJson(key, JSON.stringify(req.body));

      const now = new Date();
      await db
        .update(submissionAttempts)
        .set({
          state: 'uploaded',
          manifestObjectKey: key,
          uploadedAt: now,
          updatedAt: now,
        })
        .where(eq(submissionAttempts.id, attempt.id));
      await db
        .update(attestations)
        .set({ state: 'uploaded', updatedAt: now })
        .where(eq(attestations.id, attestation.id));

      await writeAuditEvent(db, {
        tenantId: attestation.tenantId,
        actorUserId: attestation.createdByUserId,
        actorDeviceId: device.id,
        category: AUDIT_CATEGORIES.attestationLifecycle,
        action: AUDIT_ACTIONS.attestationManifestUploaded,
        targetType: 'submission_attempt',
        targetId: attempt.id,
        payload: { manifestObjectKey: key },
      });

      reply.code(200).send({
        attempt: {
          id: attempt.id,
          state: 'uploaded',
          manifestObjectKey: key,
        },
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /attestations/:id/attempts/:attemptId/finalize  (device-signed)
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string; attemptId: string } }>(
    '/attestations/:id/attempts/:attemptId/finalize',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const device = req.currentDevice!;
      const { attestation, attempt } = await loadAttestationAttempt(
        db,
        req.params.id,
        req.params.attemptId,
      );
      if (!attestation || !attempt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (attestation.createdByDeviceId !== device.id) {
        return reply.code(403).send({ error: 'wrong_device' });
      }
      if (attempt.state !== 'uploaded') {
        return reply
          .code(409)
          .send({ error: 'attempt_not_uploaded', state: attempt.state });
      }

      await db
        .update(attestations)
        .set({ state: 'validating', updatedAt: new Date() })
        .where(eq(attestations.id, attestation.id));

      await enqueueAttestationValidation({
        attestationId: attestation.id,
        attemptId: attempt.id,
        requestId: req.id,
      });

      await writeAuditEvent(db, {
        tenantId: attestation.tenantId,
        actorUserId: attestation.createdByUserId,
        actorDeviceId: device.id,
        category: AUDIT_CATEGORIES.attestationLifecycle,
        action: AUDIT_ACTIONS.attestationFinalized,
        targetType: 'submission_attempt',
        targetId: attempt.id,
      });

      reply.code(202).send({
        attestation: { id: attestation.id, state: 'validating' },
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /attestations/:id/cancel  (device-signed)
  //
  // Producer-initiated cancellation of a pre-confirmed attestation
  // (docs/v1 §11.4 "Uploaded/pre-confirmed — Can cancel"). Used by the
  // desktop when a local manifest build fails after the attestation row
  // has already been created, so the producer can reclaim the label
  // without server-side cleanup. Confirmed attestations are immutable;
  // failed_needs_review uses the repair flow instead.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/attestations/:id/cancel',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const device = req.currentDevice!;
      const attRows = await db
        .select()
        .from(attestations)
        .where(eq(attestations.id, req.params.id))
        .limit(1);
      const attestation = attRows[0];
      if (!attestation) return reply.code(404).send({ error: 'not_found' });
      if (attestation.createdByDeviceId !== device.id) {
        return reply.code(403).send({ error: 'wrong_device' });
      }
      if (
        attestation.state !== 'pending' &&
        attestation.state !== 'uploaded'
      ) {
        return reply.code(409).send({
          error: 'attestation_not_cancellable',
          state: attestation.state,
        });
      }

      // Rename the label on cancel so the producer can reuse it. The DB
      // has a UNIQUE (project_id, label) index that can't filter on
      // state without a migration; suffixing the canceled row keeps the
      // history visible while freeing the original label for a fresh
      // create. The suffix is unique-per-cancel-row so a producer who
      // cancels twice with the same label doesn't collide.
      const canceledLabel = `${attestation.label}__canceled-${attestation.id.slice(
        0,
        8,
      )}`;
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(attestations)
          .set({ state: 'canceled', label: canceledLabel, updatedAt: now })
          .where(eq(attestations.id, attestation.id));
        await tx
          .update(submissionAttempts)
          .set({ state: 'canceled', updatedAt: now })
          .where(
            and(
              eq(submissionAttempts.attestationId, attestation.id),
              inArray(submissionAttempts.state, ['pending', 'uploaded']),
            ),
          );
      });

      await writeAuditEvent(db, {
        tenantId: attestation.tenantId,
        actorUserId: attestation.createdByUserId,
        actorDeviceId: device.id,
        category: AUDIT_CATEGORIES.attestationLifecycle,
        action: AUDIT_ACTIONS.attestationCanceled,
        targetType: 'attestation',
        targetId: attestation.id,
        payload: { previousState: attestation.state },
      });

      reply.code(200).send({
        attestation: { id: attestation.id, state: 'canceled' },
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /attestations/:id/attempts  (device-signed) — repair/resubmit
  //
  // Creates a fresh submission attempt for an existing attestation that
  // failed validation (docs/v1 §11.4). The attestation_id stays stable;
  // a new attempt_id is minted in `pending` and the device proceeds
  // through the existing upload-manifest → finalize loop. Failed attempts
  // are retained for audit history.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/attestations/:id/attempts',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const device = req.currentDevice!;
      const attRows = await db
        .select()
        .from(attestations)
        .where(eq(attestations.id, req.params.id))
        .limit(1);
      const attestation = attRows[0];
      if (!attestation) return reply.code(404).send({ error: 'not_found' });
      if (attestation.createdByDeviceId !== device.id) {
        return reply.code(403).send({ error: 'wrong_device' });
      }
      if (attestation.state !== 'failed_needs_review') {
        return reply.code(409).send({
          error: 'attestation_not_repairable',
          state: attestation.state,
        });
      }

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, attestation.projectId))
        .limit(1);
      if (!project) {
        return reply.code(500).send({ error: 'project_missing' });
      }

      const now = new Date();
      const [attempt] = await db
        .insert(submissionAttempts)
        .values({
          attestationId: attestation.id,
          state: 'pending',
        })
        .returning();
      if (!attempt) throw new Error('failed to insert attempt');
      // Move the attestation back to 'pending' so the upload-manifest +
      // finalize loop accepts the new attempt under its existing guard.
      await db
        .update(attestations)
        .set({ state: 'pending', updatedAt: now })
        .where(eq(attestations.id, attestation.id));

      await writeAuditEvent(db, {
        tenantId: attestation.tenantId,
        actorUserId: attestation.createdByUserId,
        actorDeviceId: device.id,
        category: AUDIT_CATEGORIES.attestationLifecycle,
        action: AUDIT_ACTIONS.attestationCreated,
        targetType: 'submission_attempt',
        targetId: attempt.id,
        payload: { repair: true, attestationId: attestation.id },
      });

      reply.code(201).send({
        attestation: {
          id: attestation.id,
          label: attestation.label,
          state: 'pending',
        },
        attempt: { id: attempt.id, state: attempt.state },
        project: { id: project.id, slug: project.slug },
        tenant: {
          id: attestation.tenantId,
          slug: req.currentDeviceTenant!.slug,
        },
      });
    },
  );

  // GET /attestations/:id/repair-info  (device-signed)
  // Minimal projection the desktop needs to repopulate the wizard when
  // resuming a failed attestation. Restricted to the device that owns it.
  app.get<{ Params: { id: string } }>(
    '/attestations/:id/repair-info',
    { preHandler: requireDeviceSignature },
    async (req, reply) => {
      const device = req.currentDevice!;
      const rows = await db
        .select({ attestation: attestations, project: projects })
        .from(attestations)
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .where(eq(attestations.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: 'not_found' });
      if (row.attestation.createdByDeviceId !== device.id) {
        return reply.code(403).send({ error: 'wrong_device' });
      }
      return {
        attestation: {
          id: row.attestation.id,
          label: row.attestation.label,
          state: row.attestation.state,
        },
        project: { id: row.project.id, slug: row.project.slug },
        tenant: {
          id: row.attestation.tenantId,
          slug: req.currentDeviceTenant!.slug,
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/projects/:projectSlug/attestations
  // (session or device auth)
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string; projectSlug: string } }>(
    '/tenants/:slug/projects/:projectSlug/attestations',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      let tenantId: string | null = null;
      if (req.currentDevice) {
        if (req.currentDeviceTenant!.slug !== req.params.slug) {
          return reply.code(404).send({ error: 'not_found' });
        }
        tenantId = req.currentDeviceTenant!.id;
      } else {
        const user = req.currentUser as User;
        const ctx = await resolveTenantContext(db, user, req.params.slug);
        if (!ctx) return reply.code(404).send({ error: 'not_found' });
        tenantId = ctx.tenant.id;
      }

      const projectRows = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.tenantId, tenantId),
            eq(projects.slug, req.params.projectSlug),
          ),
        )
        .limit(1);
      const project = projectRows[0];
      if (!project) return reply.code(404).send({ error: 'not_found' });

      const rows = await db
        .select()
        .from(attestations)
        .where(eq(attestations.projectId, project.id));
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
          createdAt: a.createdAt.toISOString(),
          confirmedAt: a.confirmedAt ? a.confirmedAt.toISOString() : null,
          verificationLinkId: receiptLinkByAttestationId.get(a.id) ?? null,
          projectSlug: project.slug,
          projectName: project.name,
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /attestations/:id  (session or device auth — caller must be in tenant)
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/attestations/:id',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const rows = await db
        .select({
          attestation: attestations,
          tenantSlug: tenants.slug,
        })
        .from(attestations)
        .innerJoin(tenants, eq(tenants.id, attestations.tenantId))
        .where(eq(attestations.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: 'not_found' });

      if (!(await hasTenantReadAccess(req, row.attestation.tenantId))) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const att = row.attestation;

      // Submission attempt history — repair/resubmit keeps the attestation_id
      // stable and adds a new attempt per upload; failed attempts are retained
      // (docs/v1 §11.4). Surfaced oldest-first so the desktop app can show the trail.
      const attemptRows = await db
        .select()
        .from(submissionAttempts)
        .where(eq(submissionAttempts.attestationId, att.id));
      const attempts = attemptRows
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((a) => ({
          id: a.id,
          state: a.state,
          validationError: a.validationError,
          isConfirmed: a.id === att.confirmedAttemptId,
          createdAt: a.createdAt.toISOString(),
          uploadedAt: a.uploadedAt ? a.uploadedAt.toISOString() : null,
          validatedAt: a.validatedAt ? a.validatedAt.toISOString() : null,
          failedAt: a.failedAt ? a.failedAt.toISOString() : null,
          sourceMetadata: publicSourceMetadata(a.sourceMetadata),
        }));

      // Surface the active receipt verification link id so clients can
      // build /v/:linkId.pdf download URLs without an extra round-trip.
      let verificationLinkId = await findActiveLinkForTarget(
        db,
        'receipt',
        att.id,
      );
      if (!verificationLinkId && att.receiptJsonObjectKey) {
        verificationLinkId = await issueVerificationLink(db, {
          tenantId: att.tenantId,
          targetType: 'receipt',
          targetRef: att.id,
          createdByUserId: null,
        });
      }
      const coverage = await summarizeAttestationCoverage(
        att.manifestObjectKey,
      );

      return {
        attestation: {
          id: att.id,
          label: att.label,
          state: att.state,
          confirmedAttemptId: att.confirmedAttemptId,
          manifestObjectKey: att.manifestObjectKey,
          merkleRoot: att.merkleRoot,
          packageId: att.packageId,
          receiptAvailable: att.receiptJsonObjectKey !== null,
          verificationLinkId,
          createdAt: att.createdAt.toISOString(),
          confirmedAt: att.confirmedAt ? att.confirmedAt.toISOString() : null,
          tenantSlug: row.tenantSlug,
          coverageType: coverage.coverageType,
          shinglingPresets: coverage.shinglingPresets,
          extractionMethods: coverage.extractionMethods,
        },
        attempts,
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /attestations/:id/receipt
  // (session or device auth — caller must be in tenant)
  // -----------------------------------------------------------------------
  // Streams back the JSON receipt from object storage. The receipt is the
  // canonical evidence artifact (docs/v1 §18.1); 404 until the receipt-generation
  // worker job has issued it.
  app.get<{ Params: { id: string } }>(
    '/attestations/:id/receipt',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const rows = await db
        .select({
          id: attestations.id,
          tenantId: attestations.tenantId,
          receiptJsonObjectKey: attestations.receiptJsonObjectKey,
        })
        .from(attestations)
        .where(eq(attestations.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: 'not_found' });

      if (!(await hasTenantReadAccess(req, row.tenantId))) {
        return reply.code(404).send({ error: 'not_found' });
      }

      if (!row.receiptJsonObjectKey) {
        return reply.code(404).send({ error: 'receipt_not_available' });
      }

      const receiptText = await getJsonText(row.receiptJsonObjectKey);
      const receipt = JSON.parse(receiptText) as AttestationReceipt;
      let verificationLinkId = await findActiveLinkForTarget(
        db,
        'receipt',
        row.id,
      );
      if (!verificationLinkId) {
        verificationLinkId = await issueVerificationLink(db, {
          tenantId: row.tenantId,
          targetType: 'receipt',
          targetRef: row.id,
          createdByUserId: null,
        });
      }
      return { receipt, signatureValid: null, verificationLinkId };
    },
  );

  // -----------------------------------------------------------------------
  // Attestation access grants (docs/v1 §16.2)
  //
  // Tenant admins grant specific users (typically consumers in other
  // tenants) scoped access to a private attestation. Producers cannot grant.
  // Revocation is soft so the grants table doubles as an audit trail; a
  // re-grant after a revoke is a new row.
  // -----------------------------------------------------------------------

  const loadOwnedAttestation = async (
    tenantId: string,
    attestationId: string,
  ): Promise<typeof attestations.$inferSelect | undefined> => {
    const rows = await db
      .select()
      .from(attestations)
      .where(
        and(
          eq(attestations.id, attestationId),
          eq(attestations.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0];
  };

  const canManageAccess = (
    ctx: Awaited<ReturnType<typeof resolveRequestTenantContext>>,
    attestation: typeof attestations.$inferSelect,
  ): boolean =>
    Boolean(
      ctx &&
        (ctx.membership.role === 'tenant_admin' ||
          (ctx.membership.role === 'producer' &&
            attestation.createdByUserId === ctx.user.id)),
    );

  // POST /tenants/:slug/attestations/:id/access-grants
  // Tenant admins can manage any tenant attestation. Producers can manage
  // verifier access only for attestations they created.
  app.post<{
    Params: { slug: string; id: string };
  }>(
    '/tenants/:slug/attestations/:id/access-grants',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            message: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });

      const attestation = await loadOwnedAttestation(
        ctx.tenant.id,
        req.params.id,
      );
      if (!attestation) return reply.code(404).send({ error: 'not_found' });
      if (!canManageAccess(ctx, attestation)) {
        throw app.httpErrors.forbidden();
      }

      const email = (req.body as { email: string }).email.trim().toLowerCase();
      const message =
        (req.body as { message?: string }).message?.trim() || null;

      // Two paths based on whether the recipient already has an account:
      //   - existing user → claimed grant (granted_to_user_id set, no token)
      //   - unknown email → pending grant (token_hash set, claimed on register)
      // In both cases grants are keyed by email for idempotency so admins
      // don't accidentally double-grant by clicking twice.
      const [targetUser] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      const existing = await db
        .select()
        .from(attestationAccessGrants)
        .where(
          and(
            eq(attestationAccessGrants.attestationId, attestation.id),
            eq(attestationAccessGrants.grantedToEmail, email),
            isNull(attestationAccessGrants.revokedAt),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return reply.code(200).send({
          grant: {
            id: existing[0].id,
            grantedToEmail: existing[0].grantedToEmail,
            createdAt: existing[0].createdAt.toISOString(),
            pending: existing[0].claimedAt === null && !existing[0].grantedToUserId,
          },
        });
      }

      // Mint a token only for the unknown-email path; existing users don't
      // need to register, so we'd just be sending them a dead token.
      const tokenPair = targetUser ? null : generateToken();

      const [inserted] = await db
        .insert(attestationAccessGrants)
        .values({
          attestationId: attestation.id,
          tenantId: ctx.tenant.id,
          grantedToEmail: email,
          grantedToUserId: targetUser ? targetUser.id : null,
          tokenHash: tokenPair ? tokenPair.hash : null,
          claimedAt: targetUser ? new Date() : null,
          grantedByUserId: ctx.user.id,
        })
        .returning();
      if (!inserted) throw new Error('failed to insert grant');

      if (notifications) {
        await notifications.sendAttestationAccessGrant({
          to: email,
          tenantName: ctx.tenant.name,
          attestationLabel: attestation.label,
          grantedByEmail: ctx.user.email,
          message,
          token: tokenPair ? tokenPair.token : null,
        });
      }

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessGranted,
        targetType: 'attestation_access_grant',
        targetId: inserted.id,
        payload: {
          attestationId: attestation.id,
          grantedToEmail: email,
          message,
          pending: tokenPair !== null,
        },
      });

      reply.code(201).send({
        grant: {
          id: inserted.id,
          grantedToEmail: email,
          createdAt: inserted.createdAt.toISOString(),
          pending: tokenPair !== null,
        },
      });
    },
  );

  // GET /tenants/:slug/attestations/:id/access-grants
  app.get<{ Params: { slug: string; id: string } }>(
    '/tenants/:slug/attestations/:id/access-grants',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      const attestation = await loadOwnedAttestation(
        ctx.tenant.id,
        req.params.id,
      );
      if (!attestation) return reply.code(404).send({ error: 'not_found' });
      if (!canManageAccess(ctx, attestation)) {
        throw app.httpErrors.forbidden();
      }

      const rows = await db
        .select({
          id: attestationAccessGrants.id,
          createdAt: attestationAccessGrants.createdAt,
          grantedToEmail: attestationAccessGrants.grantedToEmail,
          claimedAt: attestationAccessGrants.claimedAt,
        })
        .from(attestationAccessGrants)
        .where(
          and(
            eq(attestationAccessGrants.attestationId, attestation.id),
            isNull(attestationAccessGrants.revokedAt),
          ),
        );

      return {
        grants: rows.map((r) => ({
          id: r.id,
          grantedToEmail: r.grantedToEmail,
          createdAt: r.createdAt.toISOString(),
          pending: r.claimedAt === null,
        })),
      };
    },
  );

  // DELETE /tenants/:slug/attestations/:id/access-grants/:grantId
  app.delete<{
    Params: { slug: string; id: string; grantId: string };
  }>(
    '/tenants/:slug/attestations/:id/access-grants/:grantId',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      const attestation = await loadOwnedAttestation(
        ctx.tenant.id,
        req.params.id,
      );
      if (!attestation) return reply.code(404).send({ error: 'not_found' });
      if (!canManageAccess(ctx, attestation)) {
        throw app.httpErrors.forbidden();
      }

      const rows = await db
        .select()
        .from(attestationAccessGrants)
        .where(
          and(
            eq(attestationAccessGrants.id, req.params.grantId),
            eq(attestationAccessGrants.attestationId, attestation.id),
          ),
        )
        .limit(1);
      const grant = rows[0];
      if (!grant) return reply.code(404).send({ error: 'not_found' });
      if (grant.revokedAt) {
        return reply.code(409).send({ error: 'already_revoked' });
      }

      await db
        .update(attestationAccessGrants)
        .set({ revokedAt: new Date() })
        .where(eq(attestationAccessGrants.id, grant.id));

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessRevoked,
        targetType: 'attestation_access_grant',
        targetId: grant.id,
        payload: { attestationId: attestation.id },
      });

      reply.code(204).send();
    },
  );

  // GET /tenants/:slug/attestation-access-requests
  // Tenant admins see all tenant requests. Producers see requests only for
  // attestations they created.
  app.get<{
    Params: { slug: string };
    Querystring: { status?: string };
  }>(
    '/tenants/:slug/attestation-access-requests',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      if (!['tenant_admin', 'producer'].includes(ctx.membership.role)) {
        throw app.httpErrors.forbidden();
      }

      const requestedStatus = req.query.status ?? 'pending';
      if (
        !['pending', 'approved', 'denied', 'all'].includes(requestedStatus)
      ) {
        return reply.code(400).send({ error: 'invalid_status' });
      }

      const filters = [
        eq(attestationAccessRequests.tenantId, ctx.tenant.id),
      ];
      if (requestedStatus !== 'all') {
        filters.push(eq(attestationAccessRequests.status, requestedStatus));
      }
      if (ctx.membership.role === 'producer') {
        filters.push(eq(attestations.createdByUserId, ctx.user.id));
      }

      const rows = await db
        .select({
          id: attestationAccessRequests.id,
          attestationId: attestationAccessRequests.attestationId,
          requestedByEmail: attestationAccessRequests.requestedByEmail,
          message: attestationAccessRequests.message,
          status: attestationAccessRequests.status,
          resolutionReason: attestationAccessRequests.resolutionReason,
          createdAt: attestationAccessRequests.createdAt,
          resolvedAt: attestationAccessRequests.resolvedAt,
          attestationLabel: attestations.label,
          projectSlug: projects.slug,
          projectName: projects.name,
        })
        .from(attestationAccessRequests)
        .innerJoin(
          attestations,
          eq(attestations.id, attestationAccessRequests.attestationId),
        )
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .where(and(...filters))
        .orderBy(desc(attestationAccessRequests.createdAt))
        .limit(100);

      return {
        requests: rows.map((row) => ({
          id: row.id,
          attestationId: row.attestationId,
          requestedByEmail: row.requestedByEmail,
          message: row.message,
          status: row.status,
          resolutionReason: row.resolutionReason,
          createdAt: row.createdAt.toISOString(),
          resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
          attestation: {
            id: row.attestationId,
            label: row.attestationLabel,
          },
          project: { slug: row.projectSlug, name: row.projectName },
        })),
      };
    },
  );

  const loadAccessRequestForResolution = async (
    tenantId: string,
    requestId: string,
  ): Promise<
    | {
        request: typeof attestationAccessRequests.$inferSelect;
        attestation: typeof attestations.$inferSelect;
      }
    | undefined
  > => {
    const rows = await db
      .select({
        request: attestationAccessRequests,
        attestation: attestations,
      })
      .from(attestationAccessRequests)
      .innerJoin(
        attestations,
        eq(attestations.id, attestationAccessRequests.attestationId),
      )
      .where(
        and(
          eq(attestationAccessRequests.id, requestId),
          eq(attestationAccessRequests.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0];
  };

  // POST /tenants/:slug/attestation-access-requests/:requestId/approve
  app.post<{
    Params: { slug: string; requestId: string };
  }>(
    '/tenants/:slug/attestation-access-requests/:requestId/approve',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: {
            reason: { type: 'string', minLength: 3, maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const resolutionReason = (req.body as { reason: string }).reason.trim();
      if (resolutionReason.length < 3) {
        return reply.code(400).send({ error: 'resolution_reason_required' });
      }
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      const row = await loadAccessRequestForResolution(
        ctx.tenant.id,
        req.params.requestId,
      );
      if (!row) return reply.code(404).send({ error: 'not_found' });
      if (!canManageAccess(ctx, row.attestation)) {
        throw app.httpErrors.forbidden();
      }
      if (row.request.status !== 'pending') {
        return reply.code(409).send({ error: 'request_already_resolved' });
      }

      const existing = await db
        .select()
        .from(attestationAccessGrants)
        .where(
          and(
            eq(attestationAccessGrants.attestationId, row.attestation.id),
            eq(
              attestationAccessGrants.grantedToEmail,
              row.request.requestedByEmail,
            ),
            isNull(attestationAccessGrants.revokedAt),
          ),
        )
        .limit(1);

      let grant = existing[0];
      if (!grant) {
        const [inserted] = await db
          .insert(attestationAccessGrants)
          .values({
            attestationId: row.attestation.id,
            tenantId: ctx.tenant.id,
            grantedToEmail: row.request.requestedByEmail,
            grantedToUserId: row.request.requestedByUserId,
            tokenHash: null,
            claimedAt: new Date(),
            grantedByUserId: ctx.user.id,
          })
          .returning();
        if (!inserted) throw new Error('failed_to_insert_grant');
        grant = inserted;

        await writeAuditEvent(db, {
          tenantId: ctx.tenant.id,
          actorUserId: ctx.user.id,
          actorDeviceId: req.currentDevice?.id,
          category: AUDIT_CATEGORIES.accessControl,
          action: AUDIT_ACTIONS.attestationAccessGranted,
          targetType: 'attestation_access_grant',
          targetId: grant.id,
          payload: {
            attestationId: row.attestation.id,
            grantedToEmail: row.request.requestedByEmail,
            sourceRequestId: row.request.id,
            pending: false,
          },
        });
      }

      const resolvedAt = new Date();
      await db
        .update(attestationAccessRequests)
        .set({
          status: 'approved',
          resolutionReason,
          resolvedByUserId: ctx.user.id,
          resolvedAt,
        })
        .where(eq(attestationAccessRequests.id, row.request.id));

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessRequestApproved,
        targetType: 'attestation_access_request',
        targetId: row.request.id,
        payload: {
          attestationId: row.attestation.id,
          requestedByEmail: row.request.requestedByEmail,
          grantId: grant.id,
          resolutionReason,
        },
      });

      return {
        request: {
          id: row.request.id,
          status: 'approved',
          resolvedAt: resolvedAt.toISOString(),
        },
        grant: {
          id: grant.id,
          grantedToEmail: grant.grantedToEmail,
          createdAt: grant.createdAt.toISOString(),
          pending: false,
        },
      };
    },
  );

  // POST /tenants/:slug/attestation-access-requests/:requestId/deny
  app.post<{
    Params: { slug: string; requestId: string };
  }>(
    '/tenants/:slug/attestation-access-requests/:requestId/deny',
    {
      preHandler: requireSessionOrDevice,
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: {
            reason: { type: 'string', minLength: 3, maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const resolutionReason = (req.body as { reason: string }).reason.trim();
      if (resolutionReason.length < 3) {
        return reply.code(400).send({ error: 'resolution_reason_required' });
      }
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      const row = await loadAccessRequestForResolution(
        ctx.tenant.id,
        req.params.requestId,
      );
      if (!row) return reply.code(404).send({ error: 'not_found' });
      if (!canManageAccess(ctx, row.attestation)) {
        throw app.httpErrors.forbidden();
      }
      if (row.request.status !== 'pending') {
        return reply.code(409).send({ error: 'request_already_resolved' });
      }

      const resolvedAt = new Date();
      await db
        .update(attestationAccessRequests)
        .set({
          status: 'denied',
          resolutionReason,
          resolvedByUserId: ctx.user.id,
          resolvedAt,
        })
        .where(eq(attestationAccessRequests.id, row.request.id));

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessRequestDenied,
        targetType: 'attestation_access_request',
        targetId: row.request.id,
        payload: {
          attestationId: row.attestation.id,
          requestedByEmail: row.request.requestedByEmail,
          resolutionReason,
        },
      });

      return {
        request: {
          id: row.request.id,
          status: 'denied',
          resolvedAt: resolvedAt.toISOString(),
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /me/attestation-access  (any authenticated user)
  //
  // The "what private attestations have I been granted access to?" surface
  // for the consumer landing. Public attestations are not listed here —
  // they're reached via direct URL/QR per §16.1.
  // -----------------------------------------------------------------------
  app.get(
    '/me/attestation-access',
    { preHandler: requireSession },
    async (req) => {
      const user = req.currentUser as User;
      const rows = await db
        .select({
          grantId: attestationAccessGrants.id,
          createdAt: attestationAccessGrants.createdAt,
          attestationId: attestations.id,
          attestationLabel: attestations.label,
          attestationConfirmedAt: attestations.confirmedAt,
          attestationState: attestations.state,
          projectSlug: projects.slug,
          projectName: projects.name,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
        })
        .from(attestationAccessGrants)
        .innerJoin(
          attestations,
          eq(attestations.id, attestationAccessGrants.attestationId),
        )
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .innerJoin(tenants, eq(tenants.id, attestations.tenantId))
        .where(
          and(
            eq(attestationAccessGrants.grantedToUserId, user.id),
            isNull(attestationAccessGrants.revokedAt),
          ),
        );

      return {
        grants: rows.map((r) => ({
          grantId: r.grantId,
          grantedAt: r.createdAt.toISOString(),
          attestation: {
            id: r.attestationId,
            label: r.attestationLabel,
            state: r.attestationState,
            confirmedAt: r.attestationConfirmedAt
              ? r.attestationConfirmedAt.toISOString()
              : null,
          },
          project: { slug: r.projectSlug, name: r.projectName },
          tenant: { slug: r.tenantSlug, name: r.tenantName },
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // Consumer scoped lookup (docs/v1 §16, Protocol V1 §9)
  //
  // Pre-lookup metadata + hash lookup against a confirmed attestation. V1
  // is whole-file only; the conservative §16.3 metadata is the only thing
  // exposed before the lookup happens. Result packages are self-verifiable
  // where Merkle math applies. spec §20.1 places this under a worker queue
  // (`proof-package-generation`); V1 executes inline and the queue is a future
  // split if lookup volume warrants.
  // -----------------------------------------------------------------------

  const canLookupAttestation = async (
    user: User,
    attestation: typeof attestations.$inferSelect,
    project: typeof projects.$inferSelect,
    tenant: typeof tenants.$inferSelect,
  ): Promise<boolean> => {
    if (project.visibility === 'public') return true;
    if (attestation.createdByUserId === user.id) return true;
    const producerContext = await resolveTenantContext(db, user, tenant.slug);
    if (producerContext?.membership.role === 'tenant_admin') return true;
    const g = await db
      .select({ id: attestationAccessGrants.id })
      .from(attestationAccessGrants)
      .where(
        and(
          eq(attestationAccessGrants.attestationId, attestation.id),
          eq(attestationAccessGrants.grantedToUserId, user.id),
          isNull(attestationAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    return Boolean(g[0]);
  };

  // Load the attestation, owning project, and tenant for a lookup. Returns
  // null when the attestation doesn't exist (404) or isn't confirmed (lookup
  // is only meaningful against confirmed attestations).
  const loadConfirmedTarget = async (
    attestationId: string,
  ): Promise<
    | {
        attestation: typeof attestations.$inferSelect;
        project: typeof projects.$inferSelect;
        tenant: typeof tenants.$inferSelect;
      }
    | null
  > => {
    const rows = await db
      .select({
        attestation: attestations,
        project: projects,
        tenant: tenants,
      })
      .from(attestations)
      .innerJoin(projects, eq(projects.id, attestations.projectId))
      .innerJoin(tenants, eq(tenants.id, attestations.tenantId))
      .where(eq(attestations.id, attestationId))
      .limit(1);
    const row = rows[0];
    if (!row || row.attestation.state !== 'confirmed') return null;
    return row;
  };

  // POST /attestations/:id/access-request — verifier asks producer/admin to
  // approve lookup access. Missing/unconfirmed ids return the same generic
  // accepted shape so request submission cannot enumerate attestations.
  app.post<{
    Params: { id: string };
  }>(
    '/attestations/:id/access-request',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 3, maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const target = await loadConfirmedTarget(req.params.id);
      if (!target) {
        return reply.code(202).send({ request: { status: 'received' } });
      }
      if (
        await canLookupAttestation(
          user,
          target.attestation,
          target.project,
          target.tenant,
        )
      ) {
        return reply.code(200).send({ request: { status: 'granted' } });
      }

      const message =
        typeof (req.body as { message?: unknown } | undefined)?.message ===
        'string'
          ? (req.body as { message: string }).message.trim()
          : '';
      if (message.length < 3) {
        return reply.code(400).send({ error: 'request_reason_required' });
      }

      const existing = await db
        .select()
        .from(attestationAccessRequests)
        .where(
          and(
            eq(attestationAccessRequests.attestationId, target.attestation.id),
            eq(attestationAccessRequests.requestedByUserId, user.id),
          ),
        )
        .orderBy(desc(attestationAccessRequests.createdAt))
        .limit(1);
      if (existing[0]) {
        if (existing[0].status === 'denied') {
          return reply.code(409).send({
            error: 'access_request_denied_final',
            request: {
              id: existing[0].id,
              status: existing[0].status,
              createdAt: existing[0].createdAt.toISOString(),
              resolvedAt: existing[0].resolvedAt
                ? existing[0].resolvedAt.toISOString()
                : null,
              resolutionReason: existing[0].resolutionReason,
            },
          });
        }
        if (existing[0].status !== 'pending') {
          return reply.code(409).send({
            error: 'access_request_already_resolved',
            request: {
              id: existing[0].id,
              status: existing[0].status,
              createdAt: existing[0].createdAt.toISOString(),
              resolvedAt: existing[0].resolvedAt
                ? existing[0].resolvedAt.toISOString()
                : null,
              resolutionReason: existing[0].resolutionReason,
            },
          });
        }
        return reply.code(200).send({
          request: {
            id: existing[0].id,
            status: existing[0].status,
            createdAt: existing[0].createdAt.toISOString(),
          },
        });
      }

      const [inserted] = await db
        .insert(attestationAccessRequests)
        .values({
          attestationId: target.attestation.id,
          tenantId: target.tenant.id,
          requestedByUserId: user.id,
          requestedByEmail: user.email,
          message,
          status: 'pending',
        })
        .returning();
      if (!inserted) throw new Error('failed_to_insert_access_request');

      await writeAuditEvent(db, {
        tenantId: target.tenant.id,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessRequested,
        targetType: 'attestation_access_request',
        targetId: inserted.id,
        payload: {
          attestationId: target.attestation.id,
          requestedByEmail: user.email,
          requestReason: message,
        },
      });

      return reply.code(201).send({
        request: {
          id: inserted.id,
          status: inserted.status,
          createdAt: inserted.createdAt.toISOString(),
        },
      });
    },
  );

  // GET /attestations/:id/access-request — verifier-facing request status.
  // Returns only the caller's own request state. Unknown/unconfirmed ids still
  // return an empty status so this cannot be used to probe for attestations.
  app.get<{ Params: { id: string } }>(
    '/attestations/:id/access-request',
    { preHandler: requireSession },
    async (req) => {
      const user = req.currentUser as User;
      const target = await loadConfirmedTarget(req.params.id);
      if (!target) return { request: null };
      if (
        await canLookupAttestation(
          user,
          target.attestation,
          target.project,
          target.tenant,
        )
      ) {
        return { request: { status: 'granted' } };
      }

      const rows = await db
        .select({
          id: attestationAccessRequests.id,
          status: attestationAccessRequests.status,
          resolutionReason: attestationAccessRequests.resolutionReason,
          createdAt: attestationAccessRequests.createdAt,
          resolvedAt: attestationAccessRequests.resolvedAt,
        })
        .from(attestationAccessRequests)
        .where(
          and(
            eq(attestationAccessRequests.attestationId, target.attestation.id),
            eq(attestationAccessRequests.requestedByUserId, user.id),
          ),
        )
        .orderBy(desc(attestationAccessRequests.createdAt))
        .limit(1);

      const request = rows[0];
      return {
        request: request
          ? {
              id: request.id,
              status: request.status,
              createdAt: request.createdAt.toISOString(),
              resolvedAt: request.resolvedAt
                ? request.resolvedAt.toISOString()
                : null,
              resolutionReason: request.resolutionReason,
            }
          : null,
      };
    },
  );

  // GET /attestations/:id/lookup — pre-lookup metadata (§16.3)
  app.get<{ Params: { id: string } }>(
    '/attestations/:id/lookup',
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.currentUser as User;
      const target = await loadConfirmedTarget(req.params.id);
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (
        !(await canLookupAttestation(
          user,
          target.attestation,
          target.project,
          target.tenant,
        ))
      ) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const { attestation, project, tenant } = target;

      // Surface coverage info — file leaves vs shingles, the shingling
      // presets, and (per ocr-v1.md §8) the extraction methods so consumers
      // can tell native-text from OCR-derived. §16.3 hides counts; methods
      // and presets are plaintext-safe.
      const coverage = await summarizeAttestationCoverage(
        attestation.manifestObjectKey,
      );

      return {
        attestation: {
          id: attestation.id,
          label: attestation.label,
          confirmedAt: attestation.confirmedAt
            ? attestation.confirmedAt.toISOString()
            : null,
          coverageType: coverage.coverageType,
          shinglingPresets: coverage.shinglingPresets,
          extractionMethods: coverage.extractionMethods,
          hashAlgorithm: 'sha256',
          hashAlgorithmVersion: '1.0',
          signatureStatus: 'verified',
          blockchainAnchoring: 'none',
        },
        project: { slug: project.slug, name: project.name },
        tenant: { slug: tenant.slug, name: tenant.name },
      };
    },
  );

  // POST /attestations/:id/lookup — perform the scoped whole-file lookup
  app.post<{
    Params: { id: string };
  }>(
    '/attestations/:id/lookup',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          anyOf: [
            { required: ['submittedHash'] },
            { required: ['candidateHashes'] },
          ],
          additionalProperties: false,
          properties: {
            submittedHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            candidateHashes: {
              type: 'array',
              minItems: 1,
              maxItems: 10000,
              items: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            },
            lookupKind: {
              type: 'string',
              enum: ['whole_file', 'content', 'exact_image', 'any'],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const target = await loadConfirmedTarget(req.params.id);
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (
        !(await canLookupAttestation(
          user,
          target.attestation,
          target.project,
          target.tenant,
        ))
      ) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const { attestation, tenant } = target;

      // Verification fair-use rate limit (docs/v1 §22.2 verifications row;
      // M13/C51). Fixed UTC-minute window keyed by tenant. Enterprise's
      // null limit + a test-mode null Redis both skip the check.
      const vfMax = limitsFor(tenant.plan).verificationsPerMinute;
      if (vfMax !== null && rateLimitRedis) {
        const bucket = Math.floor(Date.now() / 60_000);
        const key = `ratelimit:lookup:${tenant.id}:${bucket}`;
        const count = await rateLimitRedis.incr(key);
        if (count === 1) {
          // Two-minute TTL — long enough for the bucket plus headroom so
          // a clock-edge expire doesn't drop the count mid-window.
          await rateLimitRedis.expire(key, 120);
        }
        if (count > vfMax) {
          reply.header('retry-after', '60');
          return reply.code(429).send({
            error: 'verification_rate_limit_exceeded',
            limit: vfMax,
            windowSeconds: 60,
          });
        }
      }

      const lookupBody = req.body as {
        submittedHash?: string;
        candidateHashes?: string[];
        lookupKind?: 'whole_file' | 'content' | 'exact_image' | 'any';
      };
      const candidateHashes = lookupBody.candidateHashes
        ? [
            ...new Set(
              lookupBody.candidateHashes.map((hash) =>
                hash.trim().toLowerCase(),
              ),
            ),
          ]
        : [];
      const lookupKind =
        lookupBody.lookupKind ??
        (candidateHashes.length > 0 ? 'content' : 'any');
      const contentLookup = lookupKind === 'content';
      const submittedHash =
        lookupBody.submittedHash?.trim().toLowerCase() ?? candidateHashes[0]!;
      const submittedHashSet = new Set(
        contentLookup ? candidateHashes : [submittedHash],
      );

      // Load the confirmed attempt's manifest from object storage.
      if (!attestation.confirmedAttemptId || !attestation.manifestObjectKey) {
        // confirmed without a manifest key would be a bug, not a 4xx case
        return reply.code(500).send({ error: 'attestation_state_inconsistent' });
      }
      const manifestText = await getJsonText(attestation.manifestObjectKey);
      const manifest = JSON.parse(manifestText) as Manifest;

      // Look for a leaf whose canonical_payload_hash matches what the
      // consumer submitted (V1 = whole-file SHA-256). leaf_hash is the value
      // the Merkle proof verifies; leaf_id in the result package is leaf_hash.
      const matchedLeaf = manifest.leaf_set.find(
        (l) =>
          submittedHashSet.has(l.canonical_payload_hash) &&
          leafMatchesLookupKind(l, lookupKind),
      );
      const resultSubmittedHash =
        matchedLeaf?.canonical_payload_hash ?? submittedHash;

      const packageId = `pkg_${randomBytes(16).toString('hex')}`;
      const resultObjectKey = lookupResultKey(
        attestation.tenantId,
        attestation.projectId,
        attestation.id,
        packageId,
      );
      const attestationCtx = {
        label: attestation.label,
        confirmed_at: attestation.confirmedAt
          ? attestation.confirmedAt.toISOString()
          : '',
        merkle_root: attestation.merkleRoot ?? manifest.merkle_root,
        protocol_version: '1.0',
      };
      const scope = {
        tenant_id: attestation.tenantId,
        project_id: attestation.projectId,
        attestation_id: attestation.id,
      };

      let pkg: ResultPackage;
      if (matchedLeaf) {
        if (!isLeafType(matchedLeaf.leaf_type)) {
          return reply.code(500).send({ error: 'manifest_unknown_leaf_type' });
        }
        // Build the proof from raw leaf-hash bytes (Protocol V1 §6.7).
        const fromHex = (h: string): Uint8Array =>
          new Uint8Array(Buffer.from(h, 'hex'));
        const allLeafHashes = manifest.leaf_set.map((l) => fromHex(l.leaf_hash));
        const targetLeafHash = fromHex(matchedLeaf.leaf_hash);
        const proofSteps = buildMerkleProof(allLeafHashes, targetLeafHash);
        const toHex = (b: Uint8Array): string =>
          Buffer.from(b).toString('hex');
        // Sanity: the leaf_hash in the manifest must reconstruct from the
        // payload hash + leaf_type — same recompute the worker does at
        // validation time. Cheap defense-in-depth before we sign.
        const recomputed = computeLeafHash({
          protocolVersion: '1.0',
          leafType: matchedLeaf.leaf_type as LeafType,
          hashAlgorithm: 'sha256',
          canonicalPayloadHash: fromHex(matchedLeaf.canonical_payload_hash),
        });
        if (toHex(recomputed) !== matchedLeaf.leaf_hash) {
          return reply
            .code(500)
            .send({ error: 'manifest_leaf_hash_inconsistent' });
        }
        pkg = buildMatchResultPackage({
          packageId,
          submittedHash: resultSubmittedHash,
          lookupScope: scope,
          attestation: attestationCtx,
          match: {
            leaf_id: matchedLeaf.leaf_hash,
            leaf_type: matchedLeaf.leaf_type,
            ...matchMetadata(matchedLeaf.metadata),
            proof_path: proofSteps.map((s) => ({
              sibling: toHex(s.sibling),
              position: s.position,
            })),
          },
        });
      } else {
        pkg = buildNoMatchResultPackage({
          packageId,
          submittedHash: resultSubmittedHash,
          lookupScope: scope,
          attestation: attestationCtx,
        });
      }

      const signed = false;
      const finalPkg = pkg;

      await putJson(resultObjectKey, JSON.stringify(finalPkg, null, 2));

      await db.insert(verificationResults).values({
        packageId,
        attestationId: attestation.id,
        tenantId: attestation.tenantId,
        lookedUpByUserId: user.id,
        resultType: finalPkg.result_type,
        submittedHash: resultSubmittedHash,
        resultObjectKey,
        signed: signed ? 'true' : 'false',
      });

      // Issue the verification link (§18.4) — this is the share URL embedded
      // in the PDF's QR/verification text. The package_id itself remains a
      // stable, separate retrieval key.
      const linkId = await issueVerificationLink(db, {
        tenantId: attestation.tenantId,
        targetType: 'lookup_result',
        targetRef: packageId,
        createdByUserId: user.id,
      });

      // Fire-and-forget: enqueue the PDF render so it's ready by the time
      // the consumer clicks "Download PDF". The /v/:linkId.pdf endpoint
      // serves the cached PDF if present, 202 otherwise.
      try {
        await enqueuePdfRendering({ linkId, requestId: req.id });
      } catch {
        // Redis hiccup shouldn't fail the lookup; PDF render can be retried.
      }

      await writeAuditEvent(db, {
        tenantId: attestation.tenantId,
        actorUserId: user.id,
        category: AUDIT_CATEGORIES.verificationLookup,
        action: AUDIT_ACTIONS.verificationLookupPerformed,
        targetType: 'attestation',
        targetId: attestation.id,
        payload: { packageId, linkId, resultType: finalPkg.result_type, signed },
      });

      reply.code(201).send({
        package: finalPkg,
        packageId,
        linkId,
        signed,
        // The result is retrievable by package_id via /lookup-results/:id.
        retrieveUrl: `/lookup-results/${packageId}`,
        verificationUrl: `/v/${linkId}`,
      });
    },
  );

  // GET /lookup-results/:packageId — unauthenticated retrieval.
  // The package_id is unguessable and the package is signed (Team/Ent) or
  // self-verifiable (Free); sharing by package_id matches §16.1's "direct
  // URL / QR code / reference ID" model. signatureValid is null for
  // unsigned Free packages.
  app.get<{ Params: { packageId: string } }>(
    '/lookup-results/:packageId',
    async (req, reply) => {
      const rows = await db
        .select()
        .from(verificationResults)
        .where(eq(verificationResults.packageId, req.params.packageId))
        .limit(1);
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const text = await getJsonText(row.resultObjectKey);
      const pkg = JSON.parse(text) as ResultPackage;
      const signatureValid = null;
      const linkId = await findActiveLinkForTarget(
        db,
        'lookup_result',
        row.packageId,
      );
      return {
        package: pkg,
        signed: row.signed === 'true',
        signatureValid,
        linkId,
      };
    },
  );
};

/**
 * Sum the `byte_size` field across every file/sha256/v1 leaf in an
 * incoming manifest body. Used by the storage cap (M13/C49) to bound a
 * single submission against the plan's storage limit. Tolerant of
 * missing / malformed leaf metadata — anything unparseable is treated as
 * 0 bytes (the manifest validator runs later and will reject structural
 * issues before the attestation confirms).
 */
const sumIncomingFileBytes = (body: unknown): number => {
  if (!body || typeof body !== 'object') return 0;
  const leafSet = (body as { leaf_set?: unknown }).leaf_set;
  if (!Array.isArray(leafSet)) return 0;
  let total = 0;
  for (const leaf of leafSet) {
    if (!leaf || typeof leaf !== 'object') continue;
    const l = leaf as { leaf_type?: unknown; metadata?: unknown };
    if (l.leaf_type !== 'file/sha256/v1') continue;
    const meta = l.metadata as { byte_size?: unknown } | undefined;
    const size = meta?.byte_size;
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
      total += size;
    }
  }
  return total;
};

const matchMetadata = (
  metadata: unknown,
): {
  source_extraction_method?: string;
  preset?: string;
  source_index?: number;
  component_method?: string;
  media_type?: string;
} => {
  if (!metadata || typeof metadata !== 'object') return {};
  const md = metadata as Record<string, unknown>;
  return {
    ...(typeof md.source_extraction_method === 'string'
      ? { source_extraction_method: md.source_extraction_method }
      : {}),
    ...(typeof md.preset === 'string' ? { preset: md.preset } : {}),
    ...(Number.isInteger(md.source_index)
      ? { source_index: md.source_index as number }
      : {}),
    ...(typeof md.component_method === 'string'
      ? { component_method: md.component_method }
      : {}),
    ...(typeof md.media_type === 'string' ? { media_type: md.media_type } : {}),
  };
};

const leafMatchesLookupKind = (
  leaf: Manifest['leaf_set'][number],
  lookupKind: 'whole_file' | 'content' | 'exact_image' | 'any',
): boolean => {
  if (lookupKind === 'any') return true;
  if (lookupKind === 'whole_file') return leaf.leaf_type === 'file/sha256/v1';
  if (lookupKind === 'content') return leaf.leaf_type === 'shingle/sha256/v1';
  const md = leaf.metadata as { component_method?: unknown };
  return (
    leaf.leaf_type === 'component/sha256/v1' &&
    md.component_method === 'exact-image-sha256/v1'
  );
};

const loadAttestationAttempt = async (
  db: DrizzleClient,
  attestationId: string,
  attemptId: string,
): Promise<{
  attestation:
    | typeof attestations.$inferSelect
    | undefined;
  attempt: typeof submissionAttempts.$inferSelect | undefined;
}> => {
  const attRows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.id, attestationId))
    .limit(1);
  const attestation = attRows[0];
  if (!attestation) return { attestation: undefined, attempt: undefined };
  const attemptRows = await db
    .select()
    .from(submissionAttempts)
    .where(
      and(
        eq(submissionAttempts.id, attemptId),
        eq(submissionAttempts.attestationId, attestationId),
      ),
    )
    .limit(1);
  return { attestation, attempt: attemptRows[0] };
};
