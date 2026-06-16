import { randomUUID } from 'node:crypto';

import {
  type ApiEnvelope,
  type ApiKeyCredential,
  type Attestation,
  type CreateProjectInput,
  type CreateWebhookEndpointInput,
  type DocsConfig,
  type CreateHashAttestationInput,
  type EventRecord,
  type EvidenceExportFilters,
  type EvidenceExportBundle,
  type EvidenceExportJob,
  type EvidenceExportJobInput,
  type EvidenceExportJobWithManifest,
  type EvidenceExportManifest,
  type GrantVerifierAccessInput,
  type ListAttestationsOptions,
  type ListEvidenceExportJobsOptions,
  type ListEventsOptions,
  type ListProjectsOptions,
  type ListWebhooksOptions,
  type OpenApiDocument,
  type PaginatedApiEnvelope,
  type Project,
  type ProveriaClientOptions,
  type PublicApiErrorBody,
  type ReceiptMetadata,
  type RevokeVerifierAccessInput,
  type SdkRetryEvent,
  type SdkRetryOptions,
  type VerificationResult,
  type VerifierAccessGrant,
  type VerifyHashInput,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookTestInput,
} from './types.js';

type ResolvedRetryOptions = Required<
  Pick<SdkRetryOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs'>
> &
  Pick<SdkRetryOptions, 'sleep' | 'onRetry'>;

export class ProveriaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: PublicApiErrorBody,
  ) {
    super(body.error.message);
  }

  get code(): string {
    return this.body.error.code;
  }

  get retryable(): boolean {
    return this.body.error.retryable;
  }

  get requestId(): string {
    return this.body.error.requestId;
  }

  get fieldErrors() {
    return this.body.error.fieldErrors ?? [];
  }

  get details() {
    return this.body.error.details;
  }
}

export class ProveriaClient {
  readonly apiKeys: ApiKeysApi;
  readonly docs: DocsApi;
  readonly projects: ProjectsApi;
  readonly attestations: AttestationsApi;
  readonly receipts: ReceiptsApi;
  readonly events: EventsApi;
  readonly evidenceExports: EvidenceExportsApi;
  readonly webhooks: WebhooksApi;

  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly tenant?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: ResolvedRetryOptions;

  constructor(options: ProveriaClientOptions) {
    this.apiUrl = (options.apiUrl ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.tenant = options.tenant;
    this.fetchImpl = options.fetch ?? fetch;
    this.retry = {
      maxAttempts: Math.max(1, Math.floor(options.retry?.maxAttempts ?? 1)),
      baseDelayMs: Math.max(0, options.retry?.baseDelayMs ?? 250),
      maxDelayMs: Math.max(0, options.retry?.maxDelayMs ?? 2_000),
      ...(options.retry?.sleep ? { sleep: options.retry.sleep } : {}),
      ...(options.retry?.onRetry ? { onRetry: options.retry.onRetry } : {}),
    };
    this.apiKeys = new ApiKeysApi(this);
    this.docs = new DocsApi(this);
    this.projects = new ProjectsApi(this);
    this.attestations = new AttestationsApi(this);
    this.receipts = new ReceiptsApi(this);
    this.events = new EventsApi(this);
    this.evidenceExports = new EvidenceExportsApi(this);
    this.webhooks = new WebhooksApi(this);
  }

  async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<ApiEnvelope<T>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.requireApiKey()}`,
      accept: 'application/json',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    const init = {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    } satisfies RequestInit;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        const res = await this.fetchImpl(`${this.apiUrl}${path}`, init);
        const parsed = await readJson(res);
        if (!res.ok) {
          const apiError = normalizeApiError(res.status, parsed);
          if (attempt < this.retry.maxAttempts && apiError.error.retryable) {
            await this.waitForRetry({
              attempt,
              reason: 'api_error',
              status: res.status,
              errorCode: apiError.error.code,
              retryAfter: res.headers.get('retry-after'),
            });
            continue;
          }
          throw new ProveriaApiError(res.status, apiError);
        }
        return withResponseMeta(parsed, res) as ApiEnvelope<T>;
      } catch (error) {
        if (error instanceof ProveriaApiError || attempt >= this.retry.maxAttempts) {
          throw error;
        }
        await this.waitForRetry({ attempt, reason: 'network_error' });
      }
    }

    throw new Error('ProveriaClient retry loop exhausted unexpectedly.');
  }

  async publicRequest<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const parsed = await readJson(res);
    if (!res.ok) {
      throw new ProveriaApiError(res.status, normalizeApiError(res.status, parsed));
    }
    return parsed as T;
  }

  async requestPaginated<T>(path: string): Promise<PaginatedApiEnvelope<T>> {
    return this.request<T[]>(path) as Promise<PaginatedApiEnvelope<T>>;
  }

  async requestVoid(
    path: string,
    options: {
      method?: 'DELETE';
    } = {},
  ): Promise<void> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: options.method ?? 'DELETE',
      headers: {
        authorization: `Bearer ${this.requireApiKey()}`,
        accept: 'application/json',
      },
    });
    const parsed = await readJson(res);
    if (!res.ok) {
      throw new ProveriaApiError(res.status, normalizeApiError(res.status, parsed));
    }
  }

  async requestJsonArtifact(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.requireApiKey()}`,
        accept: 'application/json',
      },
    });
    const parsed = await readJson(res);
    if (!res.ok) {
      throw new ProveriaApiError(res.status, normalizeApiError(res.status, parsed));
    }
    return parsed;
  }

  async requestBytes(path: string): Promise<ArrayBuffer> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.requireApiKey()}`,
        accept: 'application/octet-stream',
      },
    });
    if (!res.ok) {
      const parsed = await readJson(res);
      throw new ProveriaApiError(res.status, normalizeApiError(res.status, parsed));
    }
    return res.arrayBuffer();
  }

  tenantPath(path = ''): string {
    return `/v1/tenants/${encodeURIComponent(this.requireTenant())}${path}`;
  }

  private requireApiKey(): string {
    if (!this.apiKey) throw new Error('ProveriaClient requires apiKey for this operation.');
    return this.apiKey;
  }

  private requireTenant(): string {
    if (!this.tenant) throw new Error('ProveriaClient requires tenant for this operation.');
    return this.tenant;
  }

  private async waitForRetry(
    input: Pick<SdkRetryEvent, 'attempt' | 'reason' | 'status' | 'errorCode'> & {
      retryAfter?: string | null;
    },
  ): Promise<void> {
    const delayMs = retryDelayMs(input.attempt, this.retry, input.retryAfter);
    this.retry.onRetry?.({
      attempt: input.attempt,
      nextAttempt: input.attempt + 1,
      maxAttempts: this.retry.maxAttempts,
      delayMs,
      reason: input.reason,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    });
    if (delayMs <= 0) return;
    await (this.retry.sleep ?? defaultSleep)(delayMs);
  }
}

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const parseRetryAfterMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
};

const retryDelayMs = (
  attempt: number,
  options: Pick<ResolvedRetryOptions, 'baseDelayMs' | 'maxDelayMs'>,
  retryAfter?: string | null,
): number => {
  const retryAfterMs = parseRetryAfterMs(retryAfter);
  if (retryAfterMs !== null) return Math.min(retryAfterMs, options.maxDelayMs);
  const exponential = options.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, options.maxDelayMs);
};

class ApiKeysApi {
  constructor(private readonly client: ProveriaClient) {}

  async current(): Promise<ApiEnvelope<ApiKeyCredential>> {
    return this.client.request(this.client.tenantPath('/api-key'));
  }
}

class DocsApi {
  constructor(private readonly client: ProveriaClient) {}

  async getOpenApi(): Promise<OpenApiDocument> {
    return this.client.publicRequest('/v1/openapi.json');
  }

  async getConfig(): Promise<DocsConfig> {
    return this.client.publicRequest('/v1/docs/config.json');
  }
}

class ProjectsApi {
  constructor(private readonly client: ProveriaClient) {}

  async list(options: ListProjectsOptions = {}): Promise<PaginatedApiEnvelope<Project>> {
    return this.client.requestPaginated(this.client.tenantPath(`/projects${queryString(options)}`));
  }

  async create(input: CreateProjectInput): Promise<ApiEnvelope<Project>> {
    return this.client.request(this.client.tenantPath('/projects'), {
      method: 'POST',
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey(),
      body: {
        slug: input.slug,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(input.classification ? { classification: input.classification } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    });
  }
}

class AttestationsApi {
  constructor(private readonly client: ProveriaClient) {}

  async list(options: ListAttestationsOptions = {}): Promise<PaginatedApiEnvelope<Attestation>> {
    return this.client.requestPaginated(
      this.client.tenantPath(`/attestations${queryString(options)}`),
    );
  }

  async createHash(input: CreateHashAttestationInput): Promise<ApiEnvelope<Attestation>> {
    const sha256 = normalizeSha256(input.sha256);
    assertSha256(sha256);
    return this.client.request(
      this.client.tenantPath(`/projects/${encodeURIComponent(input.project)}/attestations`),
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey(),
        body: {
          label: input.label,
          sha256,
          ...(input.description ? { description: input.description } : {}),
          ...(input.fileName ? { fileName: input.fileName } : {}),
          ...(input.byteSize !== undefined ? { byteSize: input.byteSize } : {}),
        },
      },
    );
  }

  async get(id: string): Promise<ApiEnvelope<Attestation>> {
    return this.client.request(this.client.tenantPath(`/attestations/${encodeURIComponent(id)}`));
  }

  async verifyHash(input: VerifyHashInput): Promise<ApiEnvelope<VerificationResult>> {
    const sha256 = normalizeSha256(input.sha256);
    assertSha256(sha256);
    return this.client.request(
      this.client.tenantPath(`/attestations/${encodeURIComponent(input.attestationId)}/lookup`),
      {
        method: 'POST',
        body: {
          submittedHash: sha256,
          ...(input.lookupKind ? { lookupKind: input.lookupKind } : {}),
        },
      },
    );
  }

  async grantVerifierAccess(
    input: GrantVerifierAccessInput,
  ): Promise<ApiEnvelope<VerifierAccessGrant>> {
    return this.client.request(
      this.client.tenantPath(
        `/attestations/${encodeURIComponent(input.attestationId)}/verifier-access`,
      ),
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey(),
        body: {
          email: input.email,
          ...(input.message ? { message: input.message } : {}),
        },
      },
    );
  }

  async revokeVerifierAccess(input: RevokeVerifierAccessInput): Promise<void> {
    return this.client.requestVoid(
      this.client.tenantPath(
        `/attestations/${encodeURIComponent(input.attestationId)}/verifier-access/${encodeURIComponent(
          input.grantId,
        )}`,
      ),
      { method: 'DELETE' },
    );
  }
}

class ReceiptsApi {
  constructor(private readonly client: ProveriaClient) {}

  async get(attestationId: string): Promise<ApiEnvelope<ReceiptMetadata>> {
    return this.client.request(
      this.client.tenantPath(`/attestations/${encodeURIComponent(attestationId)}/receipt`),
    );
  }

  async getJson(attestationId: string): Promise<unknown> {
    return this.client.requestJsonArtifact(
      this.client.tenantPath(`/attestations/${encodeURIComponent(attestationId)}/receipt.json`),
    );
  }

  async getPdf(attestationId: string): Promise<ArrayBuffer> {
    return this.client.requestBytes(
      this.client.tenantPath(`/attestations/${encodeURIComponent(attestationId)}/receipt.pdf`),
    );
  }
}

class EventsApi {
  constructor(private readonly client: ProveriaClient) {}

  async list(options: ListEventsOptions = {}): Promise<PaginatedApiEnvelope<EventRecord>> {
    return this.client.requestPaginated(this.client.tenantPath(`/events${queryString(options)}`));
  }
}

class EvidenceExportsApi {
  constructor(private readonly client: ProveriaClient) {}

  async manifest(
    filters: EvidenceExportFilters = {},
  ): Promise<ApiEnvelope<EvidenceExportManifest>> {
    return this.client.request(
      this.client.tenantPath(`/evidence-export/manifest${evidenceExportQuery(filters)}`),
    );
  }

  async createJob(
    input: EvidenceExportJobInput = {},
  ): Promise<ApiEnvelope<EvidenceExportJobWithManifest>> {
    return this.client.request(this.client.tenantPath('/evidence-export/jobs'), {
      method: 'POST',
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey(),
      body: evidenceExportBody(input),
    });
  }

  async getJob(id: string): Promise<ApiEnvelope<EvidenceExportJobWithManifest>> {
    return this.client.request(
      this.client.tenantPath(`/evidence-export/jobs/${encodeURIComponent(id)}`),
    );
  }

  async getBundle(id: string): Promise<EvidenceExportBundle> {
    const bytes = await this.client.requestBytes(
      this.client.tenantPath(`/evidence-export/jobs/${encodeURIComponent(id)}/bundle`),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as EvidenceExportBundle;
  }

  async listJobs(
    options: ListEvidenceExportJobsOptions = {},
  ): Promise<PaginatedApiEnvelope<EvidenceExportJob>> {
    return this.client.requestPaginated(
      this.client.tenantPath(`/evidence-export/jobs${queryString(options)}`),
    );
  }
}

class WebhooksApi {
  constructor(private readonly client: ProveriaClient) {}

  async listEndpoints(
    options: ListWebhooksOptions = {},
  ): Promise<PaginatedApiEnvelope<WebhookEndpoint>> {
    return this.client.requestPaginated(
      this.client.tenantPath(`/webhook-endpoints${queryString(options)}`),
    );
  }

  async createEndpoint(input: CreateWebhookEndpointInput): Promise<ApiEnvelope<WebhookEndpoint>> {
    return this.client.request(this.client.tenantPath('/webhook-endpoints'), {
      method: 'POST',
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey(),
      body: {
        url: input.url,
        events: input.events,
        ...(input.description ? { description: input.description } : {}),
      },
    });
  }

  async disableEndpoint(endpointId: string): Promise<void> {
    return this.client.requestVoid(
      this.client.tenantPath(`/webhook-endpoints/${encodeURIComponent(endpointId)}`),
      { method: 'DELETE' },
    );
  }

  async sendTest(input: WebhookTestInput): Promise<ApiEnvelope<WebhookDelivery>> {
    return this.client.request(
      this.client.tenantPath(`/webhook-endpoints/${encodeURIComponent(input.endpointId)}/test`),
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey(),
      },
    );
  }

  async listDeliveries(
    options: ListWebhooksOptions = {},
  ): Promise<PaginatedApiEnvelope<WebhookDelivery>> {
    return this.client.requestPaginated(
      this.client.tenantPath(`/webhook-deliveries${queryString(options)}`),
    );
  }
}

const parseIntegerHeader = (headers: Headers, name: string): number | null => {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const responseRateLimit = (headers: Headers) => {
  if (!headers.has('ratelimit-limit') && !headers.has('RateLimit-Limit')) return undefined;
  return {
    limit: parseIntegerHeader(headers, 'ratelimit-limit'),
    remaining: parseIntegerHeader(headers, 'ratelimit-remaining'),
    reset: parseIntegerHeader(headers, 'ratelimit-reset'),
  };
};

const withResponseMeta = (parsed: unknown, res: Response): unknown => {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'meta' in parsed &&
    parsed.meta &&
    typeof parsed.meta === 'object'
  ) {
    const rateLimit = responseRateLimit(res.headers);
    if (rateLimit) {
      return {
        ...parsed,
        meta: {
          ...parsed.meta,
          rateLimit,
        },
      };
    }
  }
  return parsed;
};

const readJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const normalizeApiError = (status: number, parsed: unknown): PublicApiErrorBody => {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'error' in parsed &&
    parsed.error &&
    typeof parsed.error === 'object'
  ) {
    return parsed as PublicApiErrorBody;
  }

  return {
    error: {
      code: 'http_error',
      message: `Request failed with HTTP ${status}.`,
      retryable: status >= 500,
      requestId: 'unknown',
    },
  };
};

const normalizeSha256 = (value: string): string => value.trim().toLowerCase();

const assertSha256 = (value: string): void => {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Expected a 64-character SHA-256 hex string.');
  }
};

const evidenceExportQuery = (filters: EvidenceExportFilters): string => {
  const params = new URLSearchParams();
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.includeEvents !== undefined) {
    params.set('includeEvents', String(filters.includeEvents));
  }
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  return params.size > 0 ? `?${params.toString()}` : '';
};

const evidenceExportBody = (filters: EvidenceExportFilters): Record<string, unknown> => ({
  ...(filters.projectId ? { projectId: filters.projectId } : {}),
  ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
  ...(filters.includeEvents !== undefined ? { includeEvents: filters.includeEvents } : {}),
  ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
});

const queryString = (values: object): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values) as Array<
    [string, string | number | boolean | undefined]
  >) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size > 0 ? `?${params.toString()}` : '';
};

const generateIdempotencyKey = (): string => `sdk_${Date.now()}_${randomUUID()}`;
