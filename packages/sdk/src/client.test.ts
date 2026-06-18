import { describe, expect, it } from 'vitest';

import { ProveriaApiError, ProveriaClient } from './client.js';

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(init?.headers)),
    },
  });

const sampleModelReleaseRecord = (): Record<string, unknown> => ({
  record_type: 'model_provenance_record',
  schema_version: '0.1',
  model: {
    name: 'Graduation Model',
    version: '2026.06',
    type: 'classifier',
    release_stage: 'production',
  },
  claim: {
    claim_type: 'model_release_approved',
    claim_text: 'This model version was approved for production release.',
    claim_scope: 'full_release_package',
    subject_type: 'model_artifact',
    subject_identifier: 'registry://models/graduation/2026.06',
    subject_hash: 'b'.repeat(64),
  },
  artifacts: {
    artifact_manifest_hash: 'c'.repeat(64),
    model_card_hash: 'd'.repeat(64),
  },
  data_provenance: {
    dataset_manifest_hash: 'e'.repeat(64),
  },
  evaluation: {
    evaluation_report_hash: 'f'.repeat(64),
    known_limitations: 'Monitor for drift.',
  },
  policy: {
    policy_id: 'AI-GOV-001',
    policy_version: '2026.1',
    policy_decision: 'approved',
  },
  approval: {
    final_approver: 'Model Risk Committee',
    final_approval_timestamp: '2026-06-04T18:00:00Z',
  },
  disclosure: {
    disclosure_mode: 'public_receipt_private_evidence',
    verification_policy: 'verify_model_release_claim',
    retention_period: '7 years',
  },
});

describe('ProveriaClient', () => {
  it('fetches public API docs without credentials', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/v1/docs/config.json')) {
          return jsonResponse({
            title: 'Proveria Public API',
            openapiUrl: '/v1/openapi.json',
            docsUrl: '/v1/docs',
            version: 'v1',
          });
        }
        return jsonResponse({
          openapi: '3.1.0',
          info: { title: 'Proveria Public API', version: 'v1' },
          paths: {},
        });
      },
    });

    await expect(client.docs.getOpenApi()).resolves.toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Proveria Public API' },
    });
    await expect(client.docs.getConfig()).resolves.toEqual({
      title: 'Proveria Public API',
      openapiUrl: '/v1/openapi.json',
      docsUrl: '/v1/docs',
      version: 'v1',
    });
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/openapi.json',
      'http://api.test/v1/docs/config.json',
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({ accept: 'application/json' });
    expect(JSON.stringify(calls[0]?.init?.headers)).not.toContain('Bearer');
  });

  it('requires credentials for protected APIs', async () => {
    const client = new ProveriaClient({
      apiUrl: 'http://api.test',
      tenant: 'evaluation-workspace',
      fetch: async () => jsonResponse({ data: [], meta: { requestId: 'req_never' } }),
    });

    await expect(client.projects.list()).rejects.toThrow(
      'ProveriaClient requires apiKey for this operation.',
    );
  });

  it('fetches current API key metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          data: {
            id: 'key_1',
            keyPrefix: 'prv_v1_test',
            scopes: ['read', 'write'],
            workspace: {
              id: 'workspace_1',
              slug: 'evaluation-workspace',
              name: 'Evaluation Workspace',
            },
            createdAt: '2026-06-05T11:55:00.000Z',
            expiresAt: null,
            lastUsedAt: null,
            usageCount: 0,
            lastUsedMethod: null,
            lastUsedPath: null,
            lastUsedStatusCode: null,
          },
          meta: { requestId: 'req_key_1', apiKeyId: 'key_1' },
        });
      },
    });

    await expect(client.apiKeys.current()).resolves.toMatchObject({
      data: {
        id: 'key_1',
        scopes: ['read', 'write'],
        usageCount: 0,
      },
      meta: { requestId: 'req_key_1', apiKeyId: 'key_1' },
    });
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/tenants/evaluation-workspace/api-key',
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer prv_v1_test',
    });
  });

  it('lists and creates projects with bearer auth and idempotency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse(
          {
            data: init?.method === 'POST' ? { id: 'project_1', slug: 'evidence' } : [],
            meta: {
              requestId: 'req_1',
              pagination: { limit: 2, offset: 0, returned: 0, hasMore: false },
            },
          },
          {
            headers: {
              'RateLimit-Limit': '600',
              'RateLimit-Remaining': '599',
              'RateLimit-Reset': '1780689660',
            },
          },
        );
      },
    });

    await expect(client.projects.list({ limit: 2 })).resolves.toEqual({
      data: [],
      meta: {
        requestId: 'req_1',
        pagination: { limit: 2, offset: 0, returned: 0, hasMore: false },
        rateLimit: { limit: 600, remaining: 599, reset: 1780689660 },
      },
    });
    await client.projects.create({
      slug: 'evidence',
      name: 'Evidence',
      classification: 'internal',
      tags: ['api'],
      visibility: 'private',
      idempotencyKey: 'project_idem_1',
    });
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/tenants/evaluation-workspace/projects?limit=2',
      'http://api.test/v1/tenants/evaluation-workspace/projects',
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer prv_v1_test',
    });
    expect(calls[1]?.init?.headers).toMatchObject({
      'idempotency-key': 'project_idem_1',
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      slug: 'evidence',
      name: 'Evidence',
      classification: 'internal',
      tags: ['api'],
      visibility: 'private',
    });
  });

  it('creates hash attestations with idempotency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          data: { id: 'att_1', state: 'validating' },
          meta: { requestId: 'req_2' },
        });
      },
    });

    await client.attestations.createHash({
      project: 'evidence',
      label: 'invoice',
      sha256: 'A'.repeat(64),
      idempotencyKey: 'idem_1',
    });

    expect(calls[0]?.url).toBe(
      'http://api.test/v1/tenants/evaluation-workspace/projects/evidence/attestations',
    );
    expect(calls[0]?.init?.headers).toMatchObject({
      'idempotency-key': 'idem_1',
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      label: 'invoice',
      sha256: 'a'.repeat(64),
    });
  });

  it('creates model release attestations with canonical source metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          data: { id: 'att_model', state: 'validating' },
          meta: { requestId: 'req_model' },
        });
      },
    });

    await client.attestations.createModelRelease({
      project: 'models',
      label: 'Graduation Model release',
      record: sampleModelReleaseRecord(),
      idempotencyKey: 'model_1',
    });

    expect(calls[0]?.url).toBe(
      'http://api.test/v1/tenants/evaluation-workspace/projects/models/attestations',
    );
    expect(calls[0]?.init?.headers).toMatchObject({
      'idempotency-key': 'model_1',
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      label: string;
      sha256: string;
      fileName: string;
      byteSize: number;
      sourceMetadata: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      label: 'Graduation Model release',
      fileName: 'model-release.json',
      sourceMetadata: {
        provider: 'model_release',
        recordType: 'model_provenance_record',
        modelName: 'Graduation Model',
        modelVersion: '2026.06',
        claimType: 'model_release_approved',
        subjectHash: 'b'.repeat(64),
        policyId: 'AI-GOV-001',
        retentionPeriod: '7 years',
      },
    });
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.sourceMetadata.canonicalHash).toBe(body.sha256);
    expect(body.byteSize).toBeGreaterThan(0);
  });

  it('passes explicit model release source metadata through hash attestations', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ data: { id: 'att_1' }, meta: { requestId: 'req_1' } });
      },
    });

    await client.attestations.createHash({
      project: 'models',
      label: 'model-release',
      sha256: 'a'.repeat(64),
      sourceMetadata: {
        provider: 'model_release',
        recordType: 'model_provenance_record',
        schemaVersion: '0.1',
        canonicalHash: 'a'.repeat(64),
        modelName: 'Graduation Model',
        modelVersion: '2026.06',
        modelType: 'classifier',
        releaseStage: 'production',
        claimType: 'model_release_approved',
        claimText: 'Approved.',
        claimScope: 'full_release_package',
        subjectType: 'model_artifact',
        subjectIdentifier: 'registry://models/graduation/2026.06',
        subjectHash: 'b'.repeat(64),
        artifactManifestHash: 'c'.repeat(64),
        modelCardHash: 'd'.repeat(64),
        datasetManifestHash: 'e'.repeat(64),
        evaluationReportHash: 'f'.repeat(64),
        policyId: 'AI-GOV-001',
        policyVersion: '2026.1',
        policyDecision: 'approved',
        finalApprover: 'Model Risk Committee',
        finalApprovalTimestamp: '2026-06-04T18:00:00Z',
        disclosureMode: 'public_receipt_private_evidence',
        verificationPolicy: 'verify_model_release_claim',
      },
    });

    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      sourceMetadata: {
        provider: 'model_release',
        canonicalHash: 'a'.repeat(64),
      },
    });
  });

  it('lists and verifies hashes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('/attestations?')) {
          return jsonResponse({
            data: [],
            meta: {
              requestId: 'req_3',
              pagination: { limit: 25, offset: 50, returned: 0, hasMore: false },
            },
          });
        }
        return jsonResponse({
          data: { packageId: 'pkg_1', verificationUrl: '/v/vrf_1' },
          meta: { requestId: 'req_3' },
        });
      },
    });

    const list = await client.attestations.list({
      project: 'evidence',
      status: 'confirmed',
      limit: 25,
      offset: 50,
    });
    expect(list.meta.pagination).toBeDefined();
    await client.attestations.verifyHash({
      attestationId: 'att_1',
      sha256: 'b'.repeat(64),
      lookupKind: 'whole_file',
    });

    expect(calls[0]?.url).toBe(
      'http://api.test/v1/tenants/evaluation-workspace/attestations?project=evidence&status=confirmed&limit=25&offset=50',
    );
    expect(calls[1]?.url).toBe(
      'http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/lookup',
    );
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      submittedHash: 'b'.repeat(64),
      lookupKind: 'whole_file',
    });
  });

  it('fetches receipt metadata and artifacts', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const pdfBytes = new Uint8Array([37, 80, 68, 70]).buffer;
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('.pdf')) {
          return new Response(pdfBytes, {
            status: 200,
            headers: { 'content-type': 'application/pdf' },
          });
        }
        if (String(url).endsWith('.json')) {
          return jsonResponse({ package_id: 'pkg_1' });
        }
        return jsonResponse({ data: { receiptAvailable: true }, meta: { requestId: 'req_9' } });
      },
    });

    await client.receipts.get('att_1');
    await expect(client.receipts.getJson('att_1')).resolves.toEqual({ package_id: 'pkg_1' });
    await expect(client.receipts.getPdf('att_1')).resolves.toBeInstanceOf(ArrayBuffer);

    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/receipt',
      'http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/receipt.json',
      'http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/receipt.pdf',
    ]);
  });

  it('grants and revokes verifier access', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          data: { id: 'grant_1', grantedToEmail: 'verifier@example.com' },
          meta: { requestId: 'req_access_1' },
        });
      },
    });

    await client.attestations.grantVerifierAccess({
      attestationId: 'att_1',
      email: 'verifier@example.com',
      message: 'Please verify this document.',
      idempotencyKey: 'grant_idem_1',
    });
    await client.attestations.revokeVerifierAccess({
      attestationId: 'att_1',
      grantId: 'grant_1',
    });

    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/verifier-access',
      'http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/verifier-access/grant_1',
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({
      'idempotency-key': 'grant_idem_1',
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: 'verifier@example.com',
      message: 'Please verify this document.',
    });
    expect(calls[1]?.init?.method).toBe('DELETE');
  });

  it('lists events and creates evidence export jobs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          data: init?.method === 'POST' ? { job: { id: 'job_1' }, manifest: {} } : [],
          meta: { requestId: 'req_4' },
        });
      },
    });

    await client.events.list({
      category: 'api_sdk_webhook',
      action: 'webhook_delivery.test_enqueued',
      targetType: 'webhook_delivery',
      targetId: 'delivery_1',
      limit: 10,
      offset: 20,
    });
    await client.evidenceExports.manifest({
      projectId: 'project_1',
      includeEvents: false,
      limit: 25,
    });
    await client.evidenceExports.createJob({
      actorUserId: 'user_1',
      includeEvents: true,
      idempotencyKey: 'export_idem_1',
    });
    await client.evidenceExports.getJob('job_1');
    await client.evidenceExports.getBundle('job_1');
    await client.evidenceExports.listJobs({ limit: 5, offset: 10 });

    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/tenants/evaluation-workspace/events?category=api_sdk_webhook&action=webhook_delivery.test_enqueued&targetType=webhook_delivery&targetId=delivery_1&limit=10&offset=20',
      'http://api.test/v1/tenants/evaluation-workspace/evidence-export/manifest?projectId=project_1&includeEvents=false&limit=25',
      'http://api.test/v1/tenants/evaluation-workspace/evidence-export/jobs',
      'http://api.test/v1/tenants/evaluation-workspace/evidence-export/jobs/job_1',
      'http://api.test/v1/tenants/evaluation-workspace/evidence-export/jobs/job_1/bundle',
      'http://api.test/v1/tenants/evaluation-workspace/evidence-export/jobs?limit=5&offset=10',
    ]);
    expect(calls[2]?.init?.method).toBe('POST');
    expect(calls[2]?.init?.headers).toMatchObject({
      'idempotency-key': 'export_idem_1',
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      actorUserId: 'user_1',
      includeEvents: true,
    });
  });

  it('manages webhook endpoints and test deliveries', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        if (String(url).endsWith('/webhook-deliveries')) {
          return jsonResponse({ data: [{ id: 'del_1' }], meta: { requestId: 'req_8' } });
        }
        if (String(url).endsWith('/test')) {
          return jsonResponse({ data: { id: 'del_test_1' }, meta: { requestId: 'req_7' } });
        }
        if (init?.method === 'POST') {
          return jsonResponse({
            data: {
              id: 'wh_1',
              url: 'https://example.com/proveria/webhooks',
              events: ['receipt.issued'],
              signingSecret: 'whsec_test',
            },
            meta: { requestId: 'req_6' },
          });
        }
        return jsonResponse({ data: [{ id: 'wh_1' }], meta: { requestId: 'req_5' } });
      },
    });

    await client.webhooks.listEndpoints({ limit: 10, offset: 20 });
    await client.webhooks.createEndpoint({
      url: 'https://example.com/proveria/webhooks',
      description: 'Example receiver',
      events: ['receipt.issued'],
      idempotencyKey: 'webhook_create_1',
    });
    await client.webhooks.sendTest({
      endpointId: 'wh_1',
      idempotencyKey: 'webhook_test_1',
    });
    await client.webhooks.listDeliveries({ limit: 5, offset: 10 });
    await client.webhooks.disableEndpoint('wh_1');

    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/v1/tenants/evaluation-workspace/webhook-endpoints?limit=10&offset=20',
      'http://api.test/v1/tenants/evaluation-workspace/webhook-endpoints',
      'http://api.test/v1/tenants/evaluation-workspace/webhook-endpoints/wh_1/test',
      'http://api.test/v1/tenants/evaluation-workspace/webhook-deliveries?limit=5&offset=10',
      'http://api.test/v1/tenants/evaluation-workspace/webhook-endpoints/wh_1',
    ]);
    expect(calls[1]?.init?.headers).toMatchObject({
      'idempotency-key': 'webhook_create_1',
    });
    expect(calls[2]?.init?.headers).toMatchObject({
      'idempotency-key': 'webhook_test_1',
    });
    expect(calls[4]?.init?.method).toBe('DELETE');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      url: 'https://example.com/proveria/webhooks',
      description: 'Example receiver',
      events: ['receipt.issued'],
    });
  });

  it('throws typed API errors with field details', async () => {
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: 'not_found',
              message: 'Nope',
              retryable: false,
              requestId: 'req_4',
              fieldErrors: [{ field: 'sha256', message: 'Invalid hash', code: 'pattern' }],
              details: { maxLength: 200 },
            },
          },
          { status: 404 },
        ),
    });

    await expect(client.projects.list()).rejects.toBeInstanceOf(ProveriaApiError);
    try {
      await client.projects.list();
      throw new Error('expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProveriaApiError);
      const apiError = error as ProveriaApiError;
      expect(apiError.status).toBe(404);
      expect(apiError.code).toBe('not_found');
      expect(apiError.retryable).toBe(false);
      expect(apiError.requestId).toBe('req_4');
      expect(apiError.fieldErrors).toEqual([
        { field: 'sha256', message: 'Invalid hash', code: 'pattern' },
      ]);
      expect(apiError.details).toEqual({ maxLength: 200 });
    }
  });

  it('retries retryable API errors and preserves mutation idempotency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const retryEvents: unknown[] = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      retry: {
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
        onRetry: (event) => retryEvents.push(event),
      },
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) {
          return jsonResponse(
            {
              error: {
                code: 'temporary_failure',
                message: 'Try again',
                retryable: true,
                requestId: 'req_retry_1',
              },
            },
            { status: 500 },
          );
        }
        return jsonResponse({
          data: { id: 'project_1', slug: 'evidence' },
          meta: { requestId: 'req_retry_2' },
        });
      },
    });

    await expect(
      client.projects.create({
        slug: 'evidence',
        name: 'Evidence',
        idempotencyKey: 'project_retry_1',
      }),
    ).resolves.toMatchObject({ data: { id: 'project_1' } });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.headers).toMatchObject({ 'idempotency-key': 'project_retry_1' });
    expect(calls[1]?.init?.headers).toMatchObject({ 'idempotency-key': 'project_retry_1' });
    expect(calls[1]?.init?.body).toBe(calls[0]?.init?.body);
    expect(retryEvents).toEqual([
      expect.objectContaining({
        attempt: 1,
        nextAttempt: 2,
        reason: 'api_error',
        status: 500,
        errorCode: 'temporary_failure',
      }),
    ]);
  });

  it('does not retry non-retryable validation errors', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse(
          {
            error: {
              code: 'invalid_request',
              message: 'Bad request',
              retryable: false,
              requestId: 'req_invalid_1',
              fieldErrors: [{ field: 'name', message: 'Name is required.', code: 'required' }],
            },
          },
          { status: 400 },
        );
      },
    });

    await expect(client.projects.create({ slug: 'evidence', name: 'Evidence' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(calls).toHaveLength(1);
  });

  it('retries network failures for protected requests', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) throw new TypeError('network unavailable');
        return jsonResponse({
          data: [],
          meta: {
            requestId: 'req_network_2',
            pagination: { limit: 100, offset: 0, returned: 0, hasMore: false },
          },
        });
      },
    });

    await expect(client.projects.list()).resolves.toMatchObject({
      meta: { requestId: 'req_network_2' },
    });
    expect(calls).toHaveLength(2);
  });

  it('uses Retry-After when retrying retryable API errors', async () => {
    const delays: number[] = [];
    const client = new ProveriaClient({
      apiKey: 'prv_v1_test',
      tenant: 'evaluation-workspace',
      apiUrl: 'http://api.test',
      retry: {
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 10_000,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
      fetch: async (_url: string | URL | Request, _init?: RequestInit) => {
        if (delays.length === 0) {
          return jsonResponse(
            {
              error: {
                code: 'rate_limited',
                message: 'Slow down',
                retryable: true,
                requestId: 'req_rate_1',
              },
            },
            { status: 429, headers: { 'Retry-After': '2' } },
          );
        }
        return jsonResponse({
          data: [],
          meta: {
            requestId: 'req_rate_2',
            pagination: { limit: 100, offset: 0, returned: 0, hasMore: false },
          },
        });
      },
    });

    await client.projects.list();
    expect(delays).toEqual([2000]);
  });
});
