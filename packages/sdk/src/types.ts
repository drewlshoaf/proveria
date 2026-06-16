export interface ProveriaClientOptions {
  apiKey?: string;
  tenant?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  retry?: SdkRetryOptions;
}

export interface SdkRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (event: SdkRetryEvent) => void;
}

export interface SdkRetryEvent {
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: 'network_error' | 'api_error';
  status?: number;
  errorCode?: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiMeta {
  requestId: string;
  apiKeyId?: string;
  rateLimit?: RateLimitMeta;
  [key: string]: unknown;
}

export interface RateLimitMeta {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface PaginationMeta {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
}

export interface PaginatedApiEnvelope<T> extends ApiEnvelope<T[]> {
  meta: ApiMeta & {
    pagination: PaginationMeta;
  };
}

export interface PublicApiFieldError {
  field: string;
  message: string;
  code?: string;
}

export interface PublicApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
    fieldErrors?: PublicApiFieldError[];
    details?: Record<string, unknown>;
  };
}

export interface DocsConfig {
  title: string;
  openapiUrl: string;
  docsUrl: string;
  version: string;
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    [key: string]: unknown;
  };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkspaceRef {
  id: string;
  slug: string;
  name: string;
}

export interface ApiKeyCredential {
  id: string;
  keyPrefix: string;
  scopes: string[];
  workspace: WorkspaceRef;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  lastUsedMethod: string | null;
  lastUsedPath: string | null;
  lastUsedStatusCode: number | null;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  workspace: WorkspaceRef;
  description: string | null;
  classification: string | null;
  tags: unknown;
  visibility: 'public' | 'private';
  createdAt: string;
  archivedAt: string | null;
}

export interface CreateProjectInput {
  slug: string;
  name: string;
  description?: string;
  classification?: string;
  tags?: string[];
  visibility?: 'public' | 'private';
  idempotencyKey?: string;
}

export interface ListProjectsOptions {
  limit?: number;
  offset?: number;
}

export interface Attestation {
  id: string;
  label: string;
  description: string | null;
  state: string;
  workspace?: WorkspaceRef;
  project?: {
    id: string;
    slug: string;
    name: string;
  };
  merkleRoot: string | null;
  packageId: string | null;
  receiptAvailable: boolean;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ListAttestationsOptions {
  project?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ReceiptMetadata {
  attestationId: string;
  attestationLabel: string;
  state: string;
  packageId: string | null;
  merkleRoot: string | null;
  receiptAvailable: boolean;
  receiptPdfAvailable: boolean;
  confirmedAt: string | null;
}

export interface CreateHashAttestationInput {
  project: string;
  label: string;
  sha256: string;
  description?: string;
  fileName?: string;
  byteSize?: number;
  idempotencyKey?: string;
}

export interface VerifyHashInput {
  attestationId: string;
  sha256: string;
  lookupKind?: 'whole_file' | 'content' | 'exact_image' | 'any';
}

export interface GrantVerifierAccessInput {
  attestationId: string;
  email: string;
  message?: string;
  idempotencyKey?: string;
}

export interface RevokeVerifierAccessInput {
  attestationId: string;
  grantId: string;
}

export interface VerifierAccessGrant {
  id: string;
  attestationId: string;
  grantedToEmail: string;
  status: 'pending' | 'claimed' | 'revoked';
  createdAt: string;
  claimedAt: string | null;
  revokedAt: string | null;
  claimToken?: string;
}

export interface VerificationResult {
  package: Record<string, unknown>;
  packageId: string;
  linkId: string;
  signed: boolean;
  retrieveUrl: string;
  verificationUrl: string;
}

export interface EventRecord {
  id: string;
  category: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface ListEventsOptions {
  category?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

export interface EvidenceExportFilters {
  projectId?: string;
  actorUserId?: string;
  includeEvents?: boolean;
  limit?: number;
}

export interface EvidenceExportJobInput extends EvidenceExportFilters {
  idempotencyKey?: string;
}

export interface ListEvidenceExportJobsOptions {
  limit?: number;
  offset?: number;
}

export interface EvidenceExportManifest {
  export: {
    type: 'evidence_manifest' | 'evidence_export_job_manifest';
    workspace: WorkspaceRef;
    generatedAt: string;
    filters: {
      projectId: string | null;
      actorUserId: string | null;
      includeEvents: boolean;
    };
    counts: {
      attestations: number;
      attempts: number;
      verificationResults: number;
      verificationLinks: number;
      events: number;
    };
  };
  attestations: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  verificationResults: Array<Record<string, unknown>>;
  verificationLinks: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

export interface EvidenceExportJob {
  id: string;
  kind: string;
  status: string;
  filters: unknown;
  artifactCount: number;
  rowCount: number;
  resultObjectKey: string | null;
  error: string | null;
  progressPercent: number;
  retryCount: number;
  maxRetries: number;
  expiresAt: string | null;
  retentionPolicy: unknown;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface EvidenceExportJobWithManifest {
  job: EvidenceExportJob;
  manifest: EvidenceExportManifest;
}

export interface EvidenceExportBundle {
  schemaVersion: '1.0';
  type: 'proveria_evidence_bundle';
  generatedAt: string;
  manifest: EvidenceExportManifest;
  artifacts: Array<{
    path: string;
    objectKey: string;
    contentType: string;
    encoding: 'base64';
    byteSize: number;
    bodyBase64: string;
  }>;
  missingArtifacts: Array<{
    path: string;
    objectKey: string;
    reason: 'not_found';
  }>;
  counts: {
    artifacts: number;
    missingArtifacts: number;
  };
}

export interface CreateWebhookEndpointInput {
  url: string;
  events: string[];
  description?: string;
  idempotencyKey?: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  createdAt: string;
  disabledAt: string | null;
  signingSecret?: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  createdAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

export interface WebhookTestInput {
  endpointId: string;
  idempotencyKey?: string;
}

export interface ListWebhooksOptions {
  limit?: number;
  offset?: number;
}
