import {
  buildSigningDigest,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import { buildManifest, type Manifest } from '@proveria/manifest';
import { OCR_V1, renderPdfPages, runOcr } from '@proveria/ocr';
import {
  computeShinglePayloadHash,
  generateShingles,
  normalizeForShingling,
  tokenizeNormalized,
} from '@proveria/shingling';
import { shell } from 'electron';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { signedRequest } from '../api-client.js';
import { readPrivateKey } from '../keychain.js';
import { loadSession } from '../session-store.js';

import { fail, ok, registerRpc } from './handlers.js';
import type {
  AttestationAccessGrantSummary,
  AttestationAccessRequestSummary,
  AttestationAttemptSummary,
  AttestationDetail,
  AttestationSummary,
  RecentAttestationSummary,
} from './types.js';

const HEX64 = /^[0-9a-f]{64}$/;
const PDF_RETRY_DELAY_MS = 2000;
const PDF_RETRY_ATTEMPTS = 5;
const MAX_OCR_PDF_BYTES = 20 * 1024 * 1024;

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

interface CreateAttestationResponse {
  attestation: {
    id: string;
    label: string;
    state: string;
    createdAt: string;
  };
  attempt: { id: string; state: string };
  project: { id: string; slug: string };
  tenant: { id: string; slug: string };
}

interface UploadManifestResponse {
  attempt: {
    id: string;
    state: string;
    manifestObjectKey: string;
  };
}

interface FinalizeResponse {
  attestation: { id: string; state: string };
}

interface AttestationListResponse {
  attestations: AttestationSummary[];
}

interface RecentAttestationsResponse {
  attestations: RecentAttestationSummary[];
}

interface AttestationDetailResponse {
  attestation: AttestationDetail;
  attempts: AttestationAttemptSummary[];
}

interface AttestationReceiptResponse {
  receipt: unknown;
  signatureValid: boolean;
  verificationLinkId?: string | null;
}

interface AccessGrantsResponse {
  grants: AttestationAccessGrantSummary[];
}

interface AccessGrantCreateResponse {
  grant: AttestationAccessGrantSummary;
}

interface AccessRequestsResponse {
  requests: AttestationAccessRequestSummary[];
}

interface AccessRequestApproveResponse {
  request: { id: string; status: string; resolvedAt: string };
  grant: AttestationAccessGrantSummary;
}

interface AccessRequestDenyResponse {
  request: { id: string; status: string; resolvedAt: string };
}

const apiErrorMessage = (err: unknown): string | null => {
  const body = (err as { body?: { error?: string; message?: string } }).body;
  if (body?.error === 'resolution_reason_required') {
    return 'Enter a reason before deciding this request.';
  }
  if (
    body?.message &&
    body.message.toLowerCase().includes('reason')
  ) {
    return 'Enter a reason before deciding this request.';
  }
  return body?.error ?? null;
};

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array(Buffer.from(hex, 'hex'));

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const sanitizePdfFilename = (name: string): string => {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+/, '');
  const withExtension = sanitized.endsWith('.pdf')
    ? sanitized
    : `${sanitized}.pdf`;
  return withExtension || 'receipt.pdf';
};

const fetchPdfWhenReady = async (url: string): Promise<Buffer> => {
  for (let attempt = 0; attempt < PDF_RETRY_ATTEMPTS; attempt += 1) {
    const res = await fetch(url);
    if (res.status === 200) {
      return Buffer.from(await res.arrayBuffer());
    }
    if (res.status === 202) {
      await sleep(PDF_RETRY_DELAY_MS);
      continue;
    }
    if (res.status === 410) {
      throw new Error('This receipt verification link has expired.');
    }
    if (res.status === 404) {
      throw new Error('This receipt PDF is unavailable.');
    }
    throw new Error(`Receipt PDF request failed with status ${res.status}.`);
  }
  throw new Error('Receipt PDF is still being prepared. Try again in a moment.');
};

const attestationTenantPath = async (
  attestationId: string,
  suffix = '',
): Promise<string> => {
  const session = await loadSession();
  if (!session) throw new Error('no_session');
  return `/tenants/${session.activeWorkspace.slug}/attestations/${attestationId}${suffix}`;
};

export const registerAttestationRpc = (): void => {
  registerRpc('attestations.ocrPdf', async ({ pdfBase64 }) => {
    try {
      const pdfBytes = Buffer.from(pdfBase64, 'base64');
      if (pdfBytes.length === 0 || pdfBytes.length > MAX_OCR_PDF_BYTES) {
        return fail(
          'invalid_ocr_pdf',
          'OCR PDF input is empty or too large for local OCR.',
        );
      }
      const pageImages = await renderPdfPages(new Uint8Array(pdfBytes));
      const ocr = await runOcr(pageImages);
      if (ocr.summary.ocrPageCount === 0) {
        return fail(
          'ocr_no_pages',
          'OCR could not read any pages from this PDF.',
        );
      }
      const normalized = normalizeForShingling(ocr.combinedText);
      const paragraphs = tokenizeNormalized(normalized);
      const normalizedTokenCount = paragraphs.reduce(
        (count, paragraph) => count + paragraph.length,
        0,
      );
      const shingles = generateShingles(paragraphs, 'standard');
      if (shingles.length === 0) {
        return fail(
          'ocr_no_shingles',
          'OCR found text, but not enough continuous text to build content proof hashes.',
        );
      }
      const seen = new Set<string>();
      const proofShingles = shingles
        .map((shingle) => ({
          sourceIndex: shingle.sourceIndex,
          canonicalPayloadHash: toHex(
            computeShinglePayloadHash(shingle.text, {
              preset: 'standard',
              sourceExtractionMethod: OCR_V1.sourceExtractionMethod,
            }),
          ),
        }))
        .filter((shingle) => {
          if (seen.has(shingle.canonicalPayloadHash)) return false;
          seen.add(shingle.canonicalPayloadHash);
          return true;
        });

      return ok({
        contentProof: {
          preset: 'standard',
          sourceExtractionMethod: OCR_V1.sourceExtractionMethod,
          normalizedTokenCount,
          shingleCount: proofShingles.length,
          shingles: proofShingles,
          ocrSummary: ocr.summary,
        },
      });
    } catch (err) {
      return fail(
        'ocr_failed',
        err instanceof Error && err.message.trim()
          ? err.message
          : 'OCR content proof could not be generated.',
      );
    }
  });

  registerRpc(
    'attestations.createWholeFile',
    async ({
      projectSlug,
      label,
      description,
      fileName,
      fileSize,
      sha256Hex,
      contentProof,
      exactImageProof,
      sourceMetadata,
    }) => {
      const session = await loadSession();
      if (!session) return fail('no_session', 'Sign in before attesting a file.');
      const privateKey = await readPrivateKey();
      if (!privateKey) {
        return fail(
          'no_private_key',
          'This desktop signing key is missing. Sign out and sign in again.',
        );
      }

      const normalizedHash = sha256Hex.trim().toLowerCase();
      if (!HEX64.test(normalizedHash)) {
        return fail('invalid_hash', 'Expected a lowercase SHA-256 hex digest.');
      }
      if (!Number.isFinite(fileSize) || fileSize < 0) {
        return fail('invalid_file_size', 'File size is invalid.');
      }
      if (
        exactImageProof &&
        (exactImageProof.method !== 'exact-image-sha256/v1' ||
          !['image/png', 'image/jpeg'].includes(exactImageProof.mediaType))
      ) {
        return fail(
          'invalid_image_proof',
          'This image proof type is not supported yet.',
        );
      }
      const contentProofShingles = contentProof?.shingles ?? [];
      if (contentProof) {
        if (
          contentProof.preset !== 'standard' ||
          !['plain-text/v1', 'pdf-text-layer/v1', 'ocr-tesseract/v1'].includes(
            contentProof.sourceExtractionMethod,
          )
        ) {
          return fail(
            'invalid_content_proof',
            'This content proof type is not supported yet.',
          );
        }
        if (
          !Number.isInteger(contentProof.normalizedTokenCount) ||
          contentProof.normalizedTokenCount < 0
        ) {
          return fail(
            'invalid_content_proof',
            'Content proof token count is invalid.',
          );
        }
        if (
          contentProofShingles.some(
            (shingle) =>
              !HEX64.test(shingle.canonicalPayloadHash.trim().toLowerCase()) ||
              !Number.isInteger(shingle.sourceIndex) ||
              shingle.sourceIndex < 0,
          )
        ) {
          return fail(
            'invalid_content_proof',
            'Content proof hashes are invalid.',
          );
        }
        if (contentProof.ocrSummary) {
          const ocr = contentProof.ocrSummary;
          if (
            contentProof.sourceExtractionMethod !== 'ocr-tesseract/v1' ||
            ocr.engine !== 'tesseract' ||
            ocr.languagePack !== 'eng' ||
            !Number.isInteger(ocr.pageCount) ||
            ocr.pageCount < 0 ||
            !Number.isInteger(ocr.ocrPageCount) ||
            ocr.ocrPageCount < 0 ||
            !Number.isInteger(ocr.failedPageCount) ||
            ocr.failedPageCount < 0 ||
            !Number.isInteger(ocr.lowConfidencePageCount) ||
            ocr.lowConfidencePageCount < 0 ||
            (ocr.meanConfidence !== null &&
              (!Number.isFinite(ocr.meanConfidence) ||
                ocr.meanConfidence < 0 ||
                ocr.meanConfidence > 100)) ||
            !Array.isArray(ocr.warnings)
          ) {
            return fail(
              'invalid_content_proof',
              'OCR content proof metadata is invalid.',
            );
          }
        }
      }

      try {
        const createPath = `/tenants/${session.activeWorkspace.slug}/projects/${projectSlug}/attestations`;
        const created = await signedRequest<CreateAttestationResponse>({
          method: 'POST',
          path: createPath,
          body: {
            label: label.trim(),
            ...(description?.trim()
              ? { description: description.trim() }
              : {}),
            ...(sourceMetadata ? { sourceMetadata } : {}),
          },
        });
        const manifestSourceMetadata =
          sourceMetadata?.provider === 'google_drive'
            ? {
                provider: 'google_drive',
                file_id: sourceMetadata.fileId,
                file_name: sourceMetadata.fileName,
                ...(sourceMetadata.mimeType
                  ? { mime_type: sourceMetadata.mimeType }
                  : {}),
                ...(Number.isInteger(sourceMetadata.size)
                  ? { size: sourceMetadata.size }
                  : {}),
                ...(sourceMetadata.modifiedTime
                  ? { modified_time: sourceMetadata.modifiedTime }
                  : {}),
                ...(sourceMetadata.googleAccountEmail
                  ? { google_account_email: sourceMetadata.googleAccountEmail }
                  : {}),
              }
            : sourceMetadata?.provider === 'model_release'
              ? {
                  provider: 'model_release',
                  record_type: sourceMetadata.recordType,
                  schema_version: sourceMetadata.schemaVersion,
                  canonical_hash: sourceMetadata.canonicalHash,
                  model_name: sourceMetadata.modelName,
                  model_version: sourceMetadata.modelVersion,
                  model_type: sourceMetadata.modelType,
                  release_stage: sourceMetadata.releaseStage,
                  claim_type: sourceMetadata.claimType,
                  claim_scope: sourceMetadata.claimScope,
                  subject_type: sourceMetadata.subjectType,
                  subject_identifier: sourceMetadata.subjectIdentifier,
                  subject_hash: sourceMetadata.subjectHash,
                  artifact_manifest_hash: sourceMetadata.artifactManifestHash,
                  model_card_hash: sourceMetadata.modelCardHash,
                  dataset_manifest_hash: sourceMetadata.datasetManifestHash,
                  evaluation_report_hash: sourceMetadata.evaluationReportHash,
                  policy_id: sourceMetadata.policyId,
                  policy_version: sourceMetadata.policyVersion,
                  policy_decision: sourceMetadata.policyDecision,
                  disclosure_mode: sourceMetadata.disclosureMode,
                  verification_policy: sourceMetadata.verificationPolicy,
                }
              : null;

        const shingleLeaves = contentProofShingles.map((shingle) => ({
          leafType: LEAF_TYPES.shingleSha256V1,
          canonicalPayloadHash: fromHex(
            shingle.canonicalPayloadHash.trim().toLowerCase(),
          ),
          metadata: {
            preset: contentProof!.preset,
            source_extraction_method: contentProof!.sourceExtractionMethod,
            source_index: shingle.sourceIndex,
          },
        }));
        const imageLeaves = exactImageProof
          ? [
              {
                leafType: LEAF_TYPES.componentSha256V1,
                canonicalPayloadHash: fromHex(normalizedHash),
                metadata: {
                  component_method: exactImageProof.method,
                  media_type: exactImageProof.mediaType,
                  file_name: fileName,
                  byte_size: fileSize,
                },
              },
            ]
          : [];

        const manifest = buildManifest({
          tenantId: created.tenant.id,
          projectId: created.project.id,
          attestationId: created.attestation.id,
          attemptId: created.attempt.id,
          createdByUserId: session.userId,
          createdByDeviceId: session.deviceId,
          createdByProfileId: session.deviceId,
          leaves: [
            {
              leafType: LEAF_TYPES.fileSha256V1,
              canonicalPayloadHash: fromHex(normalizedHash),
              metadata: {
                file_name: fileName,
                byte_size: fileSize,
                hash_source: 'desktop_renderer',
                ...(manifestSourceMetadata
                  ? { source: manifestSourceMetadata }
                  : {}),
              },
            },
            ...shingleLeaves,
            ...imageLeaves,
          ],
          sourceSummary: {
            file_count: 1,
            shingle_count: shingleLeaves.length,
            component_count: imageLeaves.length,
            ocr_page_count: contentProof?.ocrSummary?.ocrPageCount ?? 0,
          },
          extractionMetadata: {
            hashing: 'browser_subtle_sha256',
            ...(manifestSourceMetadata
              ? {
                  source: manifestSourceMetadata,
                }
              : {}),
            ...(exactImageProof
              ? {
                  image_proof: {
                    method: exactImageProof.method,
                    media_type: exactImageProof.mediaType,
                    component_count: imageLeaves.length,
                  },
                }
              : {}),
            ...(contentProof && shingleLeaves.length > 0
              ? {
                  content_proof: {
                    method: contentProof.sourceExtractionMethod,
                    preset: contentProof.preset,
                    normalized_token_count: contentProof.normalizedTokenCount,
                    shingle_count: shingleLeaves.length,
                    ...(contentProof.ocrSummary
                      ? {
                          engine: contentProof.ocrSummary.engine,
                          engine_version: contentProof.ocrSummary.engineVersion,
                          language_pack: contentProof.ocrSummary.languagePack,
                          language_pack_version:
                            contentProof.ocrSummary.languagePackVersion,
                          page_count: contentProof.ocrSummary.pageCount,
                          ocr_page_count: contentProof.ocrSummary.ocrPageCount,
                          failed_page_count:
                            contentProof.ocrSummary.failedPageCount,
                          low_confidence_page_count:
                            contentProof.ocrSummary.lowConfidencePageCount,
                          mean_confidence:
                            contentProof.ocrSummary.meanConfidence,
                          warnings: contentProof.ocrSummary.warnings,
                        }
                      : {}),
                  },
                }
              : {}),
          },
          shinglingVersion:
            shingleLeaves.length > 0 ? '1.0' : undefined,
        });

        const { digest } = buildSigningDigest(
          manifest as unknown as Record<string, unknown>,
        );
        const signature = await signEd25519(digest, privateKey);
        const signedManifest: Manifest = {
          ...manifest,
          signatures: [
            {
              signer_kind: 'device',
              key_id: session.deviceId,
              algorithm: 'ed25519',
              signature,
            },
          ],
        };

        const uploadPath = `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`;
        const uploaded = await signedRequest<UploadManifestResponse>({
          method: 'POST',
          path: uploadPath,
          body: signedManifest,
        });

        const finalized = await signedRequest<FinalizeResponse>({
          method: 'POST',
          path: `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
          body: {},
        });

        return ok({
          attestationId: finalized.attestation.id,
          attemptId: uploaded.attempt.id,
          state: finalized.attestation.state,
          merkleRoot: signedManifest.merkle_root,
          leafHash: signedManifest.leaf_set[0]!.leaf_hash,
          submittedHash: normalizedHash,
          shingleCount: shingleLeaves.length,
          componentCount: imageLeaves.length,
        });
      } catch (err) {
        const body = (err as { body?: { error?: string } }).body;
        if (body?.error === 'label_taken') {
          return fail(
            'label_taken',
            'That label is already used in this project.',
          );
        }
        if (body?.error === 'invalid_label') {
          return fail(
            'invalid_label',
            'Use letters, numbers, spaces, dots, underscores, or hyphens. The name must start with a letter or number.',
          );
        }
        if (body?.error === 'attestations_per_project_limit_reached') {
          return fail(
            'attestations_per_project_limit_reached',
            'This plan has reached the attestation limit for the project.',
          );
        }
        return fail(
          body?.error ?? 'attestation_submit_failed',
          err instanceof Error ? err.message : 'Could not submit attestation.',
        );
      }
    },
  );

  registerRpc('attestations.list', async ({ projectSlug }) => {
    const session = await loadSession();
    if (!session) return fail('no_session', 'Sign in to view attestations.');
    try {
      const response = await signedRequest<AttestationListResponse>({
        method: 'GET',
        path: `/tenants/${session.activeWorkspace.slug}/projects/${projectSlug}/attestations`,
      });
      return ok(response);
    } catch (err) {
      return fail(
        'attestations_list_failed',
        err instanceof Error ? err.message : 'Could not load attestations.',
      );
    }
  });

  registerRpc('attestations.recent', async ({ limit }) => {
    const n =
      Number.isInteger(limit) && limit && limit > 0 ? Math.min(limit, 20) : 8;
    try {
      return ok(
        await signedRequest<RecentAttestationsResponse>({
          method: 'GET',
          path: `/me/attestations/recent?limit=${n}`,
        }),
      );
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      return fail(
        body?.error ?? 'recent_attestations_failed',
        err instanceof Error
          ? err.message
          : 'Could not load recent local attestations.',
      );
    }
  });

  registerRpc('attestations.get', async ({ attestationId }) => {
    try {
      let response = await signedRequest<AttestationDetailResponse>({
        method: 'GET',
        path: `/attestations/${attestationId}`,
      });
      if (
        response.attestation.receiptAvailable &&
        !response.attestation.verificationLinkId
      ) {
        const receipt = await signedRequest<AttestationReceiptResponse>({
          method: 'GET',
          path: `/attestations/${attestationId}/receipt`,
        });
        response = {
          ...response,
          attestation: {
            ...response.attestation,
            verificationLinkId:
              receipt.verificationLinkId ??
              response.attestation.verificationLinkId,
          },
        };
      }
      return ok(response);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      return fail(
        body?.error ?? 'attestation_get_failed',
        err instanceof Error ? err.message : 'Could not load attestation.',
      );
    }
  });

  registerRpc('attestations.receipt', async ({ attestationId }) => {
    try {
      const response = await signedRequest<AttestationReceiptResponse>({
        method: 'GET',
        path: `/attestations/${attestationId}/receipt`,
      });
      return ok(response);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      if (body?.error === 'receipt_not_available') {
        return fail('receipt_not_available', 'Receipt is not available yet.');
      }
      return fail(
        body?.error ?? 'receipt_get_failed',
        err instanceof Error ? err.message : 'Could not load receipt.',
      );
    }
  });

  registerRpc('attestations.openReceiptPdf', async ({ url, filename }) => {
    try {
      const pdf = await fetchPdfWhenReady(url);
      const dir = await mkdtemp(join(tmpdir(), 'proveria-receipt-'));
      const safeFilename = sanitizePdfFilename(filename ?? 'receipt.pdf');
      const filePath = join(dir, safeFilename);
      await writeFile(filePath, pdf);
      const openError = await shell.openPath(filePath);
      if (openError) {
        return fail('receipt_pdf_open_failed', openError);
      }
      return ok({ ok: true } as const);
    } catch (err) {
      return fail(
        'receipt_pdf_open_failed',
        err instanceof Error ? err.message : 'Could not open receipt PDF.',
      );
    }
  });

  registerRpc('attestations.accessGrants.list', async ({ attestationId }) => {
    try {
      return ok(
        await signedRequest<AccessGrantsResponse>({
          method: 'GET',
          path: await attestationTenantPath(attestationId, '/access-grants'),
        }),
      );
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      return fail(
        body?.error ?? 'access_grants_list_failed',
        err instanceof Error ? err.message : 'Could not load access grants.',
      );
    }
  });

  registerRpc(
    'attestations.accessGrants.create',
    async ({ attestationId, email, message }) => {
      try {
        return ok(
          await signedRequest<AccessGrantCreateResponse>({
            method: 'POST',
            path: await attestationTenantPath(attestationId, '/access-grants'),
            body: { email, message },
          }),
        );
      } catch (err) {
        const body = (err as { body?: { error?: string } }).body;
        return fail(
          body?.error ?? 'access_grant_create_failed',
          body?.error === 'invalid_email'
            ? 'Enter a valid email address.'
            : err instanceof Error
              ? err.message
              : 'Could not grant access.',
        );
      }
    },
  );

  registerRpc(
    'attestations.accessGrants.revoke',
    async ({ attestationId, grantId }) => {
      try {
        await signedRequest<void>({
          method: 'DELETE',
          path: await attestationTenantPath(
            attestationId,
            `/access-grants/${grantId}`,
          ),
        });
        return ok({ ok: true } as const);
      } catch (err) {
        const body = (err as { body?: { error?: string } }).body;
        return fail(
          body?.error ?? 'access_grant_revoke_failed',
          err instanceof Error ? err.message : 'Could not revoke access.',
        );
      }
    },
  );

  registerRpc('attestations.accessRequests.list', async ({ status }) => {
    const session = await loadSession();
    if (!session) return fail('no_session', 'Sign in to view access requests.');
    const requestStatus = status ?? 'pending';
    try {
      return ok(
        await signedRequest<AccessRequestsResponse>({
          method: 'GET',
          path: `/tenants/${session.activeWorkspace.slug}/attestation-access-requests?status=${encodeURIComponent(
            requestStatus,
          )}`,
        }),
      );
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      return fail(
        body?.error ?? 'access_requests_list_failed',
        err instanceof Error ? err.message : 'Could not load access requests.',
      );
    }
  });

  registerRpc(
    'attestations.accessRequests.approve',
    async ({ requestId, reason }) => {
      const session = await loadSession();
      if (!session) return fail('no_session', 'Sign in to approve requests.');
      const trimmedReason = reason.trim();
      if (trimmedReason.length < 3) {
        return fail(
          'resolution_reason_required',
          'Enter a reason before approving access.',
        );
      }
      try {
        return ok(
          await signedRequest<AccessRequestApproveResponse>({
            method: 'POST',
            path: `/tenants/${session.activeWorkspace.slug}/attestation-access-requests/${requestId}/approve`,
            body: { reason: trimmedReason },
          }),
        );
      } catch (err) {
        return fail(
          apiErrorMessage(err) ?? 'access_request_approve_failed',
          apiErrorMessage(err) ??
            (err instanceof Error ? err.message : 'Could not approve access.'),
        );
      }
    },
  );

  registerRpc('attestations.accessRequests.deny', async ({ requestId, reason }) => {
    const session = await loadSession();
    if (!session) return fail('no_session', 'Sign in to deny requests.');
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      return fail(
        'resolution_reason_required',
        'Enter a reason before denying access.',
      );
    }
    try {
      return ok(
        await signedRequest<AccessRequestDenyResponse>({
          method: 'POST',
          path: `/tenants/${session.activeWorkspace.slug}/attestation-access-requests/${requestId}/deny`,
          body: { reason: trimmedReason },
        }),
      );
    } catch (err) {
      return fail(
        apiErrorMessage(err) ?? 'access_request_deny_failed',
        apiErrorMessage(err) ??
          (err instanceof Error ? err.message : 'Could not deny access.'),
      );
    }
  });
};
