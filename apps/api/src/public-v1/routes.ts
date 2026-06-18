import { randomBytes } from 'node:crypto';

import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '@proveria/audit';
import {
  buildMerkleProof,
  computeLeafHash,
  isLeafType,
  LEAF_TYPES,
  type LeafType,
} from '@proveria/crypto-core';
import {
  attestationAccessGrants,
  attestations,
  auditEvents,
  exportJobs,
  projects,
  submissionAttempts,
  users,
  verificationLinks,
  verificationResults,
  webhookDeliveries,
  webhookEndpoints,
  type ApiKey,
  type Attestation,
  type AuditEvent,
  type DrizzleClient,
  type Project,
  type Tenant,
} from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';
import {
  buildMatchResultPackage,
  buildNoMatchResultPackage,
  type ResultPackage,
} from '@proveria/proofs';
import { writeAuditEvent } from '../audit/writer.js';
import { requireApiKeyFactory } from '../auth/api-keys.js';
import { generateToken } from '../auth/tokens.js';
import { cleanupExpiredEvidenceExports } from '../evidence-export/cleanup.js';
import {
  checkAttestationsPerProjectLimit,
  checkMonthlyAttestationLimit,
  checkStorageLimit,
} from '../entitlements/limits.js';
import { issueVerificationLink } from '../links/util.js';
import {
  deleteObject,
  getJsonText,
  getObjectBytes,
  lookupResultKey,
  manifestKey,
  putJson,
  putObject,
} from '../objects/client.js';
import {
  enqueueAttestationValidation,
  enqueueEvidenceExport,
  enqueuePdfRendering,
  enqueueWebhookDelivery,
} from '../queues/producer.js';
import {
  WEBHOOK_SUPPORTED_EVENTS,
  generateWebhookSecret,
  isWebhookEventType,
  signWebhookPayload,
} from '../webhooks/signing.js';
import {
  findReplay,
  idempotencyHeader,
  type IdempotencyReplay,
  requestHash,
  storeReplay,
} from './idempotency.js';
import { publicV1OpenApi } from './openapi.js';

export interface PublicV1PluginOptions {
  db: DrizzleClient;
  putJson?: (key: string, body: Buffer | string) => Promise<void>;
  putObject?: (key: string, body: Buffer | string, contentType: string) => Promise<void>;
  getJsonText?: (key: string) => Promise<string>;
  getObjectBytes?: (key: string) => Promise<Buffer | null>;
  deleteObject?: (key: string) => Promise<void>;
  enqueueAttestationValidation?: (job: {
    attestationId: string;
    attemptId: string;
    requestId?: string;
  }) => Promise<void>;
  enqueuePdfRendering?: (job: { linkId: string; requestId?: string }) => Promise<void>;
  enqueueEvidenceExport?: (job: { jobId: string; requestId?: string }) => Promise<void>;
  enqueueWebhookDelivery?: (job: { deliveryId: string; requestId?: string }) => Promise<void>;
}

interface PublicFieldError {
  field: string;
  message: string;
  code?: string;
}

interface PublicErrorOptions {
  retryable?: boolean;
  fieldErrors?: PublicFieldError[];
  details?: Record<string, unknown>;
}

const publicError = (
  requestId: string,
  code: string,
  message: string,
  retryableOrOptions: boolean | PublicErrorOptions = false,
) => {
  const options =
    typeof retryableOrOptions === 'boolean'
      ? { retryable: retryableOrOptions }
      : retryableOrOptions;
  return {
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      requestId,
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
  };
};

const publicFieldError = (
  field: string,
  message: string,
  code?: string,
): PublicFieldError => ({
  field,
  message,
  ...(code ? { code } : {}),
});

const normalizeValidationField = (instancePath?: string, missingProperty?: string): string => {
  if (missingProperty) return missingProperty;
  if (!instancePath) return 'body';
  return instancePath
    .replace(/^\//, '')
    .replace(/\//g, '.')
    .replace(/~1/g, '/')
    .replace(/~0/g, '~');
};

const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

const idempotencyKeyRequiredError = (requestId: string) =>
  publicError(
    requestId,
    'idempotency_key_required',
    'Mutating public API requests require an Idempotency-Key header.',
    {
      fieldErrors: [
        publicFieldError(
          'Idempotency-Key',
          'Mutating public API requests require an Idempotency-Key header.',
          'required',
        ),
      ],
    },
  );

const invalidIdempotencyKeyError = (requestId: string) =>
  publicError(requestId, 'invalid_idempotency_key', 'Idempotency-Key is too long.', {
    fieldErrors: [
      publicFieldError(
        'Idempotency-Key',
        `Idempotency-Key must be ${IDEMPOTENCY_KEY_MAX_LENGTH} characters or fewer.`,
        'maxLength',
      ),
    ],
    details: { maxLength: IDEMPOTENCY_KEY_MAX_LENGTH },
  });

const idempotencyKeyConflictError = (
  requestId: string,
  key: string,
  method: string,
  path: string,
) =>
  publicError(
    requestId,
    'idempotency_key_conflict',
    'This Idempotency-Key was already used with a different request body.',
    {
      details: {
        idempotencyKey: key,
        method,
        path,
      },
    },
  );

const API_DOCS_CONFIG = {
  title: 'Proveria Public API',
  openapiUrl: '/v1/openapi.json',
  docsUrl: '/v1/docs',
  version: publicV1OpenApi.info.version,
};

const publicV1DocsHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Proveria Public API Docs</title>
    <style>
      body {
        margin: 0;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
        color: #171717;
        background: #fafafa;
      }
      header {
        border-bottom: 1px solid #dedede;
        background: #ffffff;
        padding: 20px 28px;
      }
      h1 {
        margin: 0;
        font-size: 22px;
        font-weight: 650;
      }
      p {
        margin: 8px 0 0;
        color: #626262;
        font-size: 14px;
      }
      label {
        display: block;
        color: #404040;
        font-size: 12px;
        font-weight: 650;
        margin: 14px 0 6px;
      }
      input,
      textarea,
      select {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid #d7d7d7;
        background: #ffffff;
        color: #171717;
        font: inherit;
        font-size: 14px;
        padding: 10px 11px;
      }
      textarea {
        min-height: 140px;
        resize: vertical;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      button {
        border: 1px solid #171717;
        background: #171717;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        padding: 10px 13px;
      }
      button.secondary {
        background: #ffffff;
        color: #171717;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      main {
        display: grid;
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
        min-height: calc(100vh - 89px);
      }
      nav {
        border-right: 1px solid #dedede;
        background: #ffffff;
        padding: 24px;
        overflow: auto;
      }
      section {
        padding: 24px 32px 56px;
      }
      a {
        color: #007d8c;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      code {
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .route {
        border: 1px solid #dedede;
        background: #ffffff;
        color: #171717;
        cursor: pointer;
        margin-top: 10px;
        padding: 12px;
        text-align: left;
        width: 100%;
      }
      .route.active {
        border-color: #007d8c;
        box-shadow: inset 3px 0 0 #007d8c;
      }
      .method {
        display: inline-block;
        color: #007d8c;
        min-width: 58px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .path {
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow-wrap: anywhere;
      }
      .summary {
        color: #626262;
        margin-top: 8px;
      }
      .panel {
        border: 1px solid #dedede;
        background: #ffffff;
        padding: 18px;
        margin-bottom: 16px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      .mono {
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow-wrap: anywhere;
      }
      pre {
        background: #f4f4f4;
        border: 1px solid #dedede;
        margin: 10px 0 0;
        overflow: auto;
        padding: 14px;
        white-space: pre-wrap;
      }
      .small {
        font-size: 13px;
      }
      @media (max-width: 820px) {
        main {
          display: block;
        }
        nav {
          border-right: 0;
          border-bottom: 1px solid #dedede;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Proveria Public API</h1>
      <p>Live reference generated from <a href="/v1/openapi.json">/v1/openapi.json</a>.</p>
    </header>
    <main>
      <nav>
        <strong>Reference</strong>
        <p class="small">Use the OpenAPI document for generated SDKs, corp-site rendering, and API clients.</p>
        <p class="small"><a href="/v1/docs/config.json">Docs config</a></p>
        <label for="route-filter">Filter routes</label>
        <input id="route-filter" placeholder="attestations, webhooks, receipt..." />
        <div id="routes">Loading API reference...</div>
      </nav>
      <section>
        <div class="panel">
          <h2 id="operation-title">Choose an endpoint</h2>
          <p id="operation-summary">Pick an operation from the left to build a request.</p>
          <p class="mono small" id="operation-path"></p>
        </div>
        <div class="panel">
          <div class="grid">
            <div>
              <label for="api-base">API base URL</label>
              <input id="api-base" />
            </div>
            <div>
              <label for="workspace">Workspace slug</label>
              <input id="workspace" placeholder="evaluation-workspace" />
            </div>
          </div>
          <label for="api-key">API key</label>
          <input id="api-key" placeholder="prv_v1_..." type="password" />
          <div id="path-fields"></div>
          <label for="request-body">JSON body</label>
          <textarea id="request-body" spellcheck="false"></textarea>
          <p class="small" id="auth-note"></p>
        </div>
        <div class="panel">
          <strong>Generated curl</strong>
          <pre id="curl-output">Choose an endpoint to generate a command.</pre>
          <div class="actions">
            <button class="secondary" id="copy-curl" disabled>Copy curl</button>
            <button id="send-request" disabled>Send request</button>
          </div>
        </div>
        <div class="panel">
          <strong>Response</strong>
          <pre id="response-output">No request sent yet.</pre>
        </div>
      </section>
    </main>
    <script>
      const state = {
        operations: [],
        selected: null,
      };
      const els = {
        apiBase: document.getElementById('api-base'),
        apiKey: document.getElementById('api-key'),
        authNote: document.getElementById('auth-note'),
        copyCurl: document.getElementById('copy-curl'),
        curlOutput: document.getElementById('curl-output'),
        operationPath: document.getElementById('operation-path'),
        operationSummary: document.getElementById('operation-summary'),
        operationTitle: document.getElementById('operation-title'),
        pathFields: document.getElementById('path-fields'),
        requestBody: document.getElementById('request-body'),
        responseOutput: document.getElementById('response-output'),
        routeFilter: document.getElementById('route-filter'),
        routes: document.getElementById('routes'),
        sendRequest: document.getElementById('send-request'),
        workspace: document.getElementById('workspace'),
      };

      function methodHasBody(method) {
        return !['get', 'delete', 'head'].includes(method.toLowerCase());
      }

      function operationRequiresAuth(operation) {
        return !(Array.isArray(operation.security) && operation.security.length === 0);
      }

      function pathVariables(path) {
        return Array.from(path.matchAll(/\\{([^}]+)\\}/g)).map((match) => match[1]);
      }

      function defaultBody(operation) {
        const content = operation.requestBody && operation.requestBody.content;
        const json = content && content['application/json'];
        if (!json) return '';
        if (json.example) return JSON.stringify(json.example, null, 2);
        return '';
      }

      function resolvedPath() {
        if (!state.selected) return '';
        return pathVariables(state.selected.path).reduce((path, name) => {
          const input = document.getElementById('path-var-' + name);
          const value = input && input.value ? input.value.trim() : '';
          return path.replace('{' + name + '}', encodeURIComponent(value || '<' + name + '>'));
        }, state.selected.path);
      }

      function requestUrl() {
        const base = (els.apiBase.value || window.location.origin).replace(/\\/$/, '');
        return base + resolvedPath();
      }

      function renderRoutes() {
        const query = els.routeFilter.value.trim().toLowerCase();
        els.routes.innerHTML = '';
        state.operations
          .filter((operation) => {
            const haystack = [operation.method, operation.path, operation.summary].join(' ').toLowerCase();
            return !query || haystack.includes(query);
          })
          .forEach((operation, index) => {
            const button = document.createElement('button');
            button.className =
              'route' +
              (state.selected && state.selected.method === operation.method && state.selected.path === operation.path
                ? ' active'
                : '');
            button.type = 'button';
            button.addEventListener('click', () => selectOperation(operation));
            const title = document.createElement('div');
            const methodSpan = document.createElement('span');
            methodSpan.className = 'method';
            methodSpan.textContent = operation.method;
            const pathSpan = document.createElement('span');
            pathSpan.className = 'path';
            pathSpan.textContent = operation.path;
            title.appendChild(methodSpan);
            title.appendChild(pathSpan);
            button.appendChild(title);
            if (operation.summary) {
              const summary = document.createElement('div');
              summary.className = 'summary small';
              summary.textContent = operation.summary;
              button.appendChild(summary);
            }
            els.routes.appendChild(button);
            if (index === 0 && !state.selected) selectOperation(operation);
          });
      }

      function selectOperation(operation) {
        state.selected = operation;
        els.operationTitle.textContent = operation.summary || operation.method.toUpperCase() + ' ' + operation.path;
        els.operationSummary.textContent = operation.description || 'Build a request against this operation.';
        els.operationPath.textContent = operation.method.toUpperCase() + ' ' + operation.path;
        els.requestBody.value = defaultBody(operation);
        els.requestBody.disabled = !methodHasBody(operation.method);
        els.pathFields.innerHTML = '';
        for (const name of pathVariables(operation.path)) {
          const label = document.createElement('label');
          label.htmlFor = 'path-var-' + name;
          label.textContent = name;
          const input = document.createElement('input');
          input.id = 'path-var-' + name;
          input.value = name === 'slug' ? els.workspace.value : '';
          input.placeholder = name === 'slug' ? 'evaluation-workspace' : name;
          input.addEventListener('input', updateCurl);
          els.pathFields.appendChild(label);
          els.pathFields.appendChild(input);
        }
        const requiresAuth = operationRequiresAuth(operation);
        els.authNote.textContent = requiresAuth
          ? 'This operation requires a workspace API key.'
          : 'This operation is public and does not require an API key.';
        els.copyCurl.disabled = false;
        els.sendRequest.disabled = false;
        renderRoutes();
        updateCurl();
      }

      function curlQuote(value) {
        return "'" + String(value).replaceAll("'", "'\\\\''") + "'";
      }

      function generatedCurl() {
        if (!state.selected) return 'Choose an endpoint to generate a command.';
        const parts = ['curl -sS', '-X', state.selected.method.toUpperCase(), curlQuote(requestUrl())];
        if (operationRequiresAuth(state.selected)) {
          parts.push('-H', curlQuote('Authorization: Bearer ' + (els.apiKey.value || '<api-key>')));
        }
        if (methodHasBody(state.selected.method)) {
          parts.push('-H', curlQuote('Content-Type: application/json'));
          parts.push('-H', curlQuote('Idempotency-Key: <idempotency-key>'));
          parts.push('-d', curlQuote(els.requestBody.value || '{}'));
        }
        return parts.join(' \\\\\\n  ');
      }

      function updateCurl() {
        els.curlOutput.textContent = generatedCurl();
      }

      async function sendRequest() {
        if (!state.selected) return;
        const headers = {};
        if (operationRequiresAuth(state.selected) && els.apiKey.value.trim()) {
          headers.Authorization = 'Bearer ' + els.apiKey.value.trim();
        }
        const init = { method: state.selected.method.toUpperCase(), headers };
        if (methodHasBody(state.selected.method)) {
          headers['Content-Type'] = 'application/json';
          headers['Idempotency-Key'] = 'docs-' + crypto.randomUUID();
          init.body = els.requestBody.value || '{}';
        }
        els.responseOutput.textContent = 'Sending...';
        const response = await fetch(requestUrl(), init);
        const text = await response.text();
        let body = text;
        try {
          body = JSON.stringify(JSON.parse(text), null, 2);
        } catch (_) {
          // Keep non-JSON responses as text.
        }
        els.responseOutput.textContent = response.status + ' ' + response.statusText + '\\n\\n' + body;
      }

      async function loadDocs() {
        const response = await fetch('/v1/openapi.json');
        const spec = await response.json();
        els.apiBase.value = window.location.origin;
        els.workspace.value = 'evaluation-workspace';
        for (const [path, methods] of Object.entries(spec.paths || {})) {
          for (const [method, operation] of Object.entries(methods || {})) {
            state.operations.push({
              method,
              operation,
              path,
              summary: operation.summary || '',
              description: operation.description || '',
              requestBody: operation.requestBody,
              security: operation.security,
            });
          }
        }
        renderRoutes();
      }
      els.apiBase.addEventListener('input', updateCurl);
      els.apiKey.addEventListener('input', updateCurl);
      els.copyCurl.addEventListener('click', () => navigator.clipboard.writeText(generatedCurl()));
      els.requestBody.addEventListener('input', updateCurl);
      els.routeFilter.addEventListener('input', renderRoutes);
      els.sendRequest.addEventListener('click', () => sendRequest().catch((error) => {
        els.responseOutput.textContent = 'Request failed: ' + error.message;
      }));
      els.workspace.addEventListener('input', () => {
        const slug = document.getElementById('path-var-slug');
        if (slug) slug.value = els.workspace.value;
        updateCurl();
      });
      loadDocs().catch((error) => {
        document.getElementById('routes').textContent = 'Could not load OpenAPI document: ' + error.message;
      });
    </script>
  </body>
</html>`;

const prepareIdempotentWrite = async ({
  db,
  req,
  reply,
  tenant,
  apiKey,
  path,
}: {
  db: DrizzleClient;
  req: FastifyRequest;
  reply: FastifyReply;
  tenant: Tenant;
  apiKey: ApiKey;
  path: string;
}): Promise<{
  key: string;
  method: 'POST';
  path: string;
  requestHash: string;
  replay: IdempotencyReplay | null;
} | null> => {
  const key = idempotencyHeader(req.headers);
  if (!key) {
    reply.code(400).send(idempotencyKeyRequiredError(req.id));
    return null;
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    reply.code(400).send(invalidIdempotencyKeyError(req.id));
    return null;
  }

  const method = 'POST';
  const hash = requestHash(req.body);
  const replay = await findReplay(db, {
    tenantId: tenant.id,
    apiKeyId: apiKey.id,
    method,
    path,
    key,
    requestHash: hash,
  });
  if (replay === 'conflict') {
    reply.code(409).send(idempotencyKeyConflictError(req.id, key, method, path));
    return null;
  }

  return { key, method, path, requestHash: hash, replay };
};

const ensureTenantSlug = (
  req: import('fastify').FastifyRequest<{ Params: { slug: string } }>,
  reply: import('fastify').FastifyReply,
): boolean => {
  if (req.currentApiKeyTenant?.slug === req.params.slug) return true;
  reply.code(404).send(publicError(req.id, 'not_found', 'The requested resource was not found.'));
  return false;
};

const publicWorkspace = (workspace: Pick<Tenant, 'id' | 'slug' | 'name'>) => ({
  id: workspace.id,
  slug: workspace.slug,
  name: workspace.name,
});

const publicProject = (project: Project, workspace: Pick<Tenant, 'id' | 'slug' | 'name'>) => ({
  id: project.id,
  slug: project.slug,
  name: project.name,
  workspace: publicWorkspace(workspace),
  description: project.description,
  classification: project.classification,
  tags: project.tags,
  visibility: project.visibility,
  createdAt: project.createdAt.toISOString(),
  archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
});

const publicAttestation = (
  attestation: Attestation,
  project?: Pick<Project, 'id' | 'slug' | 'name'>,
  workspace?: Pick<Tenant, 'id' | 'slug' | 'name'>,
) => ({
  id: attestation.id,
  label: attestation.label,
  description: attestation.description,
  state: attestation.state,
  workspace: workspace ? publicWorkspace(workspace) : undefined,
  project: project ? { id: project.id, slug: project.slug, name: project.name } : undefined,
  merkleRoot: attestation.merkleRoot,
  packageId: attestation.packageId,
  receiptAvailable: attestation.receiptJsonObjectKey !== null,
  createdAt: attestation.createdAt.toISOString(),
  confirmedAt: attestation.confirmedAt ? attestation.confirmedAt.toISOString() : null,
});

const publicEvent = (event: AuditEvent) => ({
  id: event.id,
  category: event.category,
  action: event.action,
  targetType: event.targetType,
  targetId: event.targetId,
  payload: event.payload,
  createdAt: event.createdAt.toISOString(),
});

const publicApiCredential = (
  apiKey: ApiKey,
  workspace: Pick<Tenant, 'id' | 'slug' | 'name'>,
) => ({
  id: apiKey.id,
  keyPrefix: apiKey.keyPrefix,
  scopes: apiKey.scopes,
  workspace: publicWorkspace(workspace),
  createdAt: apiKey.createdAt.toISOString(),
  expiresAt: apiKey.expiresAt ? apiKey.expiresAt.toISOString() : null,
  lastUsedAt: apiKey.lastUsedAt ? apiKey.lastUsedAt.toISOString() : null,
  usageCount: apiKey.usageCount,
  lastUsedMethod: apiKey.lastUsedMethod,
  lastUsedPath: apiKey.lastUsedPath,
  lastUsedStatusCode: apiKey.lastUsedStatusCode,
});

const parseBoundedInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const paginationMeta = (limit: number, offset: number, returned: number, hasMore: boolean) => ({
  limit,
  offset,
  returned,
  hasMore,
});

const pageRows = <T>(rows: T[], limit: number) => ({
  rows: rows.slice(0, limit),
  hasMore: rows.length > limit,
});

const publicAccessGrant = (
  grant: typeof attestationAccessGrants.$inferSelect,
  claimToken?: string,
) => ({
  id: grant.id,
  attestationId: grant.attestationId,
  grantedToEmail: grant.grantedToEmail,
  status: grant.revokedAt
    ? 'revoked'
    : grant.claimedAt || grant.grantedToUserId
      ? 'claimed'
      : 'pending',
  createdAt: grant.createdAt.toISOString(),
  claimedAt: grant.claimedAt ? grant.claimedAt.toISOString() : null,
  revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
  ...(claimToken ? { claimToken } : {}),
});

const publicWebhookEndpoint = (
  endpoint: typeof webhookEndpoints.$inferSelect,
  secret?: string,
) => ({
  id: endpoint.id,
  url: endpoint.url,
  description: endpoint.description,
  events: endpoint.events,
  createdAt: endpoint.createdAt.toISOString(),
  disabledAt: endpoint.disabledAt ? endpoint.disabledAt.toISOString() : null,
  ...(secret ? { signingSecret: secret } : {}),
});

const publicWebhookDelivery = (delivery: typeof webhookDeliveries.$inferSelect) => ({
  id: delivery.id,
  endpointId: delivery.endpointId,
  eventType: delivery.eventType,
  status: delivery.status,
  attempts: delivery.attempts,
  responseStatus: delivery.responseStatus,
  createdAt: delivery.createdAt.toISOString(),
  lastAttemptAt: delivery.lastAttemptAt ? delivery.lastAttemptAt.toISOString() : null,
  nextAttemptAt: delivery.nextAttemptAt ? delivery.nextAttemptAt.toISOString() : null,
});

const publicExportJob = (job: typeof exportJobs.$inferSelect) => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  filters: job.filters,
  artifactCount: job.artifactCount,
  rowCount: job.rowCount,
  resultObjectKey: job.resultObjectKey,
  error: job.error,
  progressPercent: job.progressPercent,
  retryCount: job.retryCount,
  maxRetries: job.maxRetries,
  expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
  retentionPolicy: job.retentionPolicy,
  createdAt: job.createdAt.toISOString(),
  startedAt: job.startedAt ? job.startedAt.toISOString() : null,
  completedAt: job.completedAt ? job.completedAt.toISOString() : null,
});

const publicExportJobWithManifest = (job: typeof exportJobs.$inferSelect) => ({
  job: publicExportJob(job),
  manifest: job.manifest,
});

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const API_MANIFEST_DEVICE_ID = 'proveria-public-api';
const API_MANIFEST_PROFILE_ID = 'public-api';

interface ModelReleaseSourceMetadata {
  [key: string]: unknown;
  provider: 'model_release';
  recordType: 'model_provenance_record';
  schemaVersion: string;
  canonicalHash: string;
  modelName: string;
  modelVersion: string;
  modelType: string;
  releaseStage: string;
  claimType: string;
  claimText: string;
  claimScope: string;
  subjectType: string;
  subjectIdentifier: string;
  subjectHash: string;
  artifactManifestHash: string;
  modelCardHash: string;
  datasetManifestHash: string;
  evaluationReportHash: string;
  policyId: string;
  policyVersion: string;
  policyDecision: string;
  finalApprover: string;
  finalApprovalTimestamp: string;
  disclosureMode: string;
  verificationPolicy: string;
  createdByUserId: string;
  createdAt: string;
}

const modelReleaseSourceMetadataSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'provider',
    'recordType',
    'schemaVersion',
    'canonicalHash',
    'modelName',
    'modelVersion',
    'modelType',
    'releaseStage',
    'claimType',
    'claimText',
    'claimScope',
    'subjectType',
    'subjectIdentifier',
    'subjectHash',
    'artifactManifestHash',
    'modelCardHash',
    'datasetManifestHash',
    'evaluationReportHash',
    'policyId',
    'policyVersion',
    'policyDecision',
    'finalApprover',
    'finalApprovalTimestamp',
    'disclosureMode',
    'verificationPolicy',
  ],
  properties: {
    provider: { const: 'model_release' },
    recordType: { const: 'model_provenance_record' },
    schemaVersion: { type: 'string', minLength: 1, maxLength: 32 },
    canonicalHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    modelName: { type: 'string', minLength: 1, maxLength: 256 },
    modelVersion: { type: 'string', minLength: 1, maxLength: 128 },
    modelType: { type: 'string', minLength: 1, maxLength: 64 },
    releaseStage: { type: 'string', minLength: 1, maxLength: 64 },
    claimType: { type: 'string', minLength: 1, maxLength: 128 },
    claimText: { type: 'string', minLength: 1, maxLength: 4000 },
    claimScope: { type: 'string', minLength: 1, maxLength: 128 },
    subjectType: { type: 'string', minLength: 1, maxLength: 128 },
    subjectIdentifier: { type: 'string', minLength: 1, maxLength: 512 },
    subjectHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    artifactManifestHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    modelCardHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    datasetManifestHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    evaluationReportHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    riskReviewHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    policyId: { type: 'string', minLength: 1, maxLength: 256 },
    policyVersion: { type: 'string', minLength: 1, maxLength: 128 },
    policyDecision: { type: 'string', minLength: 1, maxLength: 128 },
    finalApprover: { type: 'string', minLength: 1, maxLength: 256 },
    finalApprovalTimestamp: { type: 'string', minLength: 1, maxLength: 80 },
    disclosureMode: { type: 'string', minLength: 1, maxLength: 128 },
    verificationPolicy: { type: 'string', minLength: 1, maxLength: 128 },
    retentionPeriod: { type: 'string', maxLength: 256 },
    knownLimitations: { type: 'string', maxLength: 4000 },
  },
} as const;

const modelReleaseSourceMetadataFromBody = (
  value: unknown,
  createdByUserId: string,
): ModelReleaseSourceMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const required = [
    raw.recordType,
    raw.schemaVersion,
    raw.canonicalHash,
    raw.modelName,
    raw.modelVersion,
    raw.modelType,
    raw.releaseStage,
    raw.claimType,
    raw.claimText,
    raw.claimScope,
    raw.subjectType,
    raw.subjectIdentifier,
    raw.subjectHash,
    raw.artifactManifestHash,
    raw.modelCardHash,
    raw.datasetManifestHash,
    raw.evaluationReportHash,
    raw.policyId,
    raw.policyVersion,
    raw.policyDecision,
    raw.finalApprover,
    raw.finalApprovalTimestamp,
    raw.disclosureMode,
    raw.verificationPolicy,
  ];
  if (
    raw.provider !== 'model_release' ||
    raw.recordType !== 'model_provenance_record' ||
    required.some((field) => typeof field !== 'string')
  ) {
    return null;
  }
  return {
    provider: 'model_release',
    recordType: 'model_provenance_record',
    schemaVersion: raw.schemaVersion as string,
    canonicalHash: raw.canonicalHash as string,
    modelName: raw.modelName as string,
    modelVersion: raw.modelVersion as string,
    modelType: raw.modelType as string,
    releaseStage: raw.releaseStage as string,
    claimType: raw.claimType as string,
    claimText: raw.claimText as string,
    claimScope: raw.claimScope as string,
    subjectType: raw.subjectType as string,
    subjectIdentifier: raw.subjectIdentifier as string,
    subjectHash: raw.subjectHash as string,
    artifactManifestHash: raw.artifactManifestHash as string,
    modelCardHash: raw.modelCardHash as string,
    datasetManifestHash: raw.datasetManifestHash as string,
    evaluationReportHash: raw.evaluationReportHash as string,
    ...(typeof raw.riskReviewHash === 'string' ? { riskReviewHash: raw.riskReviewHash } : {}),
    policyId: raw.policyId as string,
    policyVersion: raw.policyVersion as string,
    policyDecision: raw.policyDecision as string,
    finalApprover: raw.finalApprover as string,
    finalApprovalTimestamp: raw.finalApprovalTimestamp as string,
    disclosureMode: raw.disclosureMode as string,
    verificationPolicy: raw.verificationPolicy as string,
    createdByUserId,
    createdAt: new Date().toISOString(),
    ...(typeof raw.retentionPeriod === 'string' ? { retentionPeriod: raw.retentionPeriod } : {}),
    ...(typeof raw.knownLimitations === 'string'
      ? { knownLimitations: raw.knownLimitations }
      : {}),
  };
};
const DEFAULT_PROJECT_TEMPLATE_SLUG = 'general_provenance';
const EXPORT_JOB_RETENTION_DAYS = 30;
const EXPORT_JOB_MAX_RETRIES = 3;

const normalizeSha256 = (value: string): string => value.trim().toLowerCase();

const daysFromNow = (days: number): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

export const publicV1Plugin: FastifyPluginAsync<PublicV1PluginOptions> = async (app, opts) => {
  const { db } = opts;
  const putManifestJson = opts.putJson ?? putJson;
  const writeObject = opts.putObject ?? putObject;
  const readArtifactJson = opts.getJsonText ?? getJsonText;
  const readArtifactBytes = opts.getObjectBytes ?? getObjectBytes;
  const removeObject = opts.deleteObject ?? deleteObject;
  const enqueueValidation = opts.enqueueAttestationValidation ?? enqueueAttestationValidation;
  const enqueuePdf = opts.enqueuePdfRendering ?? enqueuePdfRendering;
  const enqueueExport = opts.enqueueEvidenceExport ?? enqueueEvidenceExport;
  const enqueueWebhook = opts.enqueueWebhookDelivery ?? enqueueWebhookDelivery;
  const requireApiKey = requireApiKeyFactory(db, 'read');
  const requireWriteApiKey = requireApiKeyFactory(db, 'write');

  app.setErrorHandler((error, req, reply) => {
    const validation = (
      error as {
        validation?: Array<{
          instancePath?: string;
          keyword?: string;
          message?: string;
          params?: { missingProperty?: string };
        }>;
      }
    ).validation;
    if (validation && validation.length > 0) {
      return reply.code(400).send(
        publicError(req.id, 'invalid_request', 'Request validation failed.', {
          fieldErrors: validation.map((issue) =>
            publicFieldError(
              normalizeValidationField(issue.instancePath, issue.params?.missingProperty),
              issue.message ?? 'Invalid value.',
              issue.keyword,
            ),
          ),
        }),
      );
    }

    req.log.error({ err: error }, 'public v1 request failed');
    const statusCode = (error as { statusCode?: number }).statusCode;
    return reply
      .code(statusCode && statusCode >= 400 ? statusCode : 500)
      .send(publicError(req.id, 'internal_error', 'The request could not be completed.'));
  });

  const buildPublicEvidenceExportManifest = async ({
    tenant,
    query,
    type = 'evidence_manifest',
  }: {
    tenant: Tenant;
    query: {
      projectId?: string;
      actorUserId?: string;
      includeEvents?: string;
      limit?: string;
    };
    type?: 'evidence_manifest' | 'evidence_export_job_manifest';
  }) => {
    const parsedLimit = Number(query.limit);
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 1000;
    const includeEvents = query.includeEvents !== 'false';
    const conditions = [eq(attestations.tenantId, tenant.id)];
    if (query.projectId) {
      conditions.push(eq(attestations.projectId, query.projectId));
    }
    if (query.actorUserId) {
      conditions.push(eq(attestations.createdByUserId, query.actorUserId));
    }

    const attestationRows = await db
      .select({
        id: attestations.id,
        label: attestations.label,
        state: attestations.state,
        projectId: attestations.projectId,
        projectSlug: projects.slug,
        projectName: projects.name,
        createdByUserId: attestations.createdByUserId,
        confirmedAttemptId: attestations.confirmedAttemptId,
        manifestObjectKey: attestations.manifestObjectKey,
        leavesObjectKey: attestations.leavesObjectKey,
        receiptJsonObjectKey: attestations.receiptJsonObjectKey,
        receiptPdfObjectKey: attestations.receiptPdfObjectKey,
        packageId: attestations.packageId,
        merkleRoot: attestations.merkleRoot,
        createdAt: attestations.createdAt,
        confirmedAt: attestations.confirmedAt,
      })
      .from(attestations)
      .innerJoin(projects, eq(projects.id, attestations.projectId))
      .where(and(...conditions))
      .orderBy(desc(attestations.createdAt))
      .limit(limit);

    const attestationIds = attestationRows.map((row) => row.id);
    const attemptRows =
      attestationIds.length > 0
        ? await db
            .select({
              id: submissionAttempts.id,
              attestationId: submissionAttempts.attestationId,
              state: submissionAttempts.state,
              manifestObjectKey: submissionAttempts.manifestObjectKey,
              leavesObjectKey: submissionAttempts.leavesObjectKey,
              validationResultObjectKey: submissionAttempts.validationResultObjectKey,
              validationError: submissionAttempts.validationError,
              createdAt: submissionAttempts.createdAt,
              uploadedAt: submissionAttempts.uploadedAt,
              validatedAt: submissionAttempts.validatedAt,
              failedAt: submissionAttempts.failedAt,
            })
            .from(submissionAttempts)
            .where(inArray(submissionAttempts.attestationId, attestationIds))
            .orderBy(desc(submissionAttempts.createdAt))
        : [];
    const resultRows =
      attestationIds.length > 0
        ? await db
            .select({
              id: verificationResults.id,
              packageId: verificationResults.packageId,
              attestationId: verificationResults.attestationId,
              lookedUpByUserId: verificationResults.lookedUpByUserId,
              resultType: verificationResults.resultType,
              submittedHash: verificationResults.submittedHash,
              resultObjectKey: verificationResults.resultObjectKey,
              signed: verificationResults.signed,
              createdAt: verificationResults.createdAt,
            })
            .from(verificationResults)
            .where(inArray(verificationResults.attestationId, attestationIds))
            .orderBy(desc(verificationResults.createdAt))
        : [];
    const linkRefs = [...attestationIds, ...resultRows.map((row) => row.packageId)];
    const linkRows =
      linkRefs.length > 0
        ? await db
            .select({
              id: verificationLinks.id,
              targetType: verificationLinks.targetType,
              targetRef: verificationLinks.targetRef,
              createdAt: verificationLinks.createdAt,
              expiresAt: verificationLinks.expiresAt,
              revokedAt: verificationLinks.revokedAt,
            })
            .from(verificationLinks)
            .where(
              and(
                eq(verificationLinks.tenantId, tenant.id),
                inArray(verificationLinks.targetRef, linkRefs),
              ),
            )
            .orderBy(desc(verificationLinks.createdAt))
        : [];
    const eventRows =
      includeEvents && attestationIds.length > 0
        ? await db
            .select({
              id: auditEvents.id,
              action: auditEvents.action,
              category: auditEvents.category,
              targetType: auditEvents.targetType,
              targetId: auditEvents.targetId,
              actorUserId: auditEvents.actorUserId,
              createdAt: auditEvents.createdAt,
            })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.tenantId, tenant.id),
                inArray(auditEvents.targetId, attestationIds),
              ),
            )
            .orderBy(desc(auditEvents.createdAt))
        : [];

    return {
      export: {
        type,
        workspace: publicWorkspace(tenant),
        generatedAt: new Date().toISOString(),
        filters: {
          projectId: query.projectId ?? null,
          actorUserId: query.actorUserId ?? null,
          includeEvents,
        },
        counts: {
          attestations: attestationRows.length,
          attempts: attemptRows.length,
          verificationResults: resultRows.length,
          verificationLinks: linkRows.length,
          events: eventRows.length,
        },
      },
      attestations: attestationRows.map((attestation) => ({
        id: attestation.id,
        label: attestation.label,
        state: attestation.state,
        project: {
          id: attestation.projectId,
          slug: attestation.projectSlug,
          name: attestation.projectName,
        },
        createdByUserId: attestation.createdByUserId,
        createdAt: attestation.createdAt.toISOString(),
        confirmedAt: attestation.confirmedAt?.toISOString() ?? null,
        packageId: attestation.packageId,
        merkleRoot: attestation.merkleRoot,
        artifacts: {
          manifest: attestation.manifestObjectKey,
          leaves: attestation.leavesObjectKey,
          receiptJson: attestation.receiptJsonObjectKey,
          receiptPdf: attestation.receiptPdfObjectKey,
        },
        confirmedAttemptId: attestation.confirmedAttemptId,
      })),
      attempts: attemptRows.map((attempt) => ({
        id: attempt.id,
        attestationId: attempt.attestationId,
        state: attempt.state,
        validationError: attempt.validationError,
        createdAt: attempt.createdAt.toISOString(),
        uploadedAt: attempt.uploadedAt?.toISOString() ?? null,
        validatedAt: attempt.validatedAt?.toISOString() ?? null,
        failedAt: attempt.failedAt?.toISOString() ?? null,
        artifacts: {
          manifest: attempt.manifestObjectKey,
          leaves: attempt.leavesObjectKey,
          validationResult: attempt.validationResultObjectKey,
        },
      })),
      verificationResults: resultRows.map((result) => ({
        id: result.id,
        packageId: result.packageId,
        attestationId: result.attestationId,
        lookedUpByUserId: result.lookedUpByUserId,
        resultType: result.resultType,
        submittedHash: result.submittedHash,
        signed: result.signed === 'true',
        createdAt: result.createdAt.toISOString(),
        artifacts: {
          resultJson: result.resultObjectKey,
        },
      })),
      verificationLinks: linkRows.map((link) => ({
        id: link.id,
        targetType: link.targetType,
        targetRef: link.targetRef,
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt?.toISOString() ?? null,
        revokedAt: link.revokedAt?.toISOString() ?? null,
      })),
      events: eventRows.map((event) => ({
        id: event.id,
        action: event.action,
        category: event.category,
        targetType: event.targetType,
        targetId: event.targetId,
        actorUserId: event.actorUserId,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  };

  app.get('/v1/openapi.json', async () => publicV1OpenApi);
  app.get('/v1/docs/config.json', async () => API_DOCS_CONFIG);
  app.get('/v1/docs', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(publicV1DocsHtml),
  );

  app.get<{ Params: { slug: string } }>(
    '/v1/tenants/:slug/api-key',
    { preHandler: requireApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      return {
        data: publicApiCredential(apiKey, tenant),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { limit?: string; offset?: string } }>(
    '/v1/tenants/:slug/projects',
    { preHandler: requireApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const limit = parseBoundedInt(req.query.limit, 100, 1, 500);
      const offset = parseBoundedInt(req.query.offset, 0, 0, 10_000);
      const fetchedRows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.tenantId, tenant.id), isNull(projects.archivedAt)))
        .orderBy(desc(projects.createdAt))
        .limit(limit + 1)
        .offset(offset);
      const { rows, hasMore } = pageRows(fetchedRows, limit);

      return {
        data: rows.map((project) => publicProject(project, tenant)),
        meta: {
          requestId: req.id,
          apiKeyId: (req.currentApiKey as ApiKey).id,
          pagination: paginationMeta(limit, offset, rows.length, hasMore),
        },
      };
    },
  );

  app.post<{
    Params: { slug: string };
    Body: {
      slug: string;
      name: string;
      description?: string;
      templateSlug?: string;
      classification?: string;
      tags?: string[];
      visibility?: 'public' | 'private';
    };
  }>(
    '/v1/tenants/:slug/projects',
    {
      preHandler: requireWriteApiKey,
      schema: {
        body: {
          type: 'object',
          required: ['slug', 'name'],
          additionalProperties: false,
          properties: {
            slug: { type: 'string', minLength: 1, maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            templateSlug: { type: 'string', deprecated: true },
            classification: { type: 'string', maxLength: 100 },
            tags: { type: 'array', items: { type: 'string', maxLength: 64 } },
            visibility: { type: 'string', enum: ['public', 'private'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const key = idempotencyHeader(req.headers);
      if (!key) {
        return reply.code(400).send(idempotencyKeyRequiredError(req.id));
      }
      if (key.length > 200) {
        return reply.code(400).send(invalidIdempotencyKeyError(req.id));
      }

      const method = 'POST';
      const path = `/v1/tenants/${req.params.slug}/projects`;
      const hash = requestHash(req.body);
      const replay = await findReplay(db, {
        tenantId: tenant.id,
        apiKeyId: apiKey.id,
        method,
        path,
        key,
        requestHash: hash,
      });
      if (replay === 'conflict') {
        return reply.code(409).send(idempotencyKeyConflictError(req.id, key, method, path));
      }
      if (replay) {
        reply.code(replay.statusCode);
        return replay.responseBody;
      }

      const body = req.body;
      const slug = body.slug.trim();
      const name = body.name.trim();
      if (!SLUG_RE.test(slug)) {
        return reply
          .code(400)
          .send(
            publicError(req.id, 'invalid_slug', 'Project slug is invalid.', {
              fieldErrors: [
                publicFieldError(
                  'slug',
                  'Project slug must use lowercase letters, numbers, and hyphens.',
                  'pattern',
                ),
              ],
            }),
          );
      }
      if (!name) {
        return reply
          .code(400)
          .send(
            publicError(req.id, 'invalid_name', 'Project name is required.', {
              fieldErrors: [publicFieldError('name', 'Project name is required.', 'required')],
            }),
          );
      }
      if (!apiKey.createdByUserId) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              'api_key_actor_unavailable',
              'This API key no longer has a user actor for project creation.',
            ),
          );
      }

      const visibility = body.visibility ?? (tenant.plan === 'free' ? 'public' : 'private');
      if (tenant.plan === 'free' && visibility === 'private') {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'private_projects_require_paid_plan',
              'Private projects require a paid plan.',
            ),
          );
      }

      const existing = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.tenantId, tenant.id), eq(projects.slug, slug)))
        .limit(1);
      if (existing[0]) {
        return reply
          .code(409)
          .send(publicError(req.id, 'slug_taken', 'A project already uses that slug.'));
      }

      const [project] = await db
        .insert(projects)
        .values({
          tenantId: tenant.id,
          slug,
          name,
          description: body.description ?? null,
          templateSlug: DEFAULT_PROJECT_TEMPLATE_SLUG,
          classification: body.classification ?? null,
          tags: body.tags ?? [],
          visibility,
          createdByUserId: apiKey.createdByUserId,
        })
        .returning();
      if (!project) throw app.httpErrors.internalServerError();

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.project,
        action: AUDIT_ACTIONS.projectCreated,
        targetType: 'project',
        targetId: project.id,
        payload: { slug: project.slug, name: project.name, apiKeyId: apiKey.id },
      });

      const responseBody = {
        data: publicProject(project, tenant),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
      await storeReplay(db, {
        tenantId: tenant.id,
        apiKey,
        method,
        path,
        key,
        requestHash: hash,
        statusCode: 201,
        responseBody,
      });

      reply.code(201);
      return responseBody;
    },
  );

  app.post<{
    Params: { slug: string; projectSlug: string };
    Body: {
      label: string;
      description?: string;
      sha256: string;
      fileName?: string;
      byteSize?: number;
      compliance?: {
        sha256: string;
        fileName?: string;
        byteSize?: number;
        mediaType?: string;
        canonicalization?: string;
      };
      sourceMetadata?: unknown;
    };
  }>(
    '/v1/tenants/:slug/projects/:projectSlug/attestations',
    {
      preHandler: requireWriteApiKey,
      schema: {
        body: {
          type: 'object',
          required: ['label', 'sha256'],
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            sha256: { type: 'string', minLength: 64, maxLength: 64 },
            fileName: { type: 'string', maxLength: 512 },
            byteSize: { type: 'integer', minimum: 0 },
            compliance: {
              type: 'object',
              required: ['sha256'],
              additionalProperties: false,
              properties: {
                sha256: { type: 'string', minLength: 64, maxLength: 64 },
                fileName: { type: 'string', maxLength: 512 },
                byteSize: { type: 'integer', minimum: 0 },
                mediaType: { type: 'string', maxLength: 100 },
                canonicalization: { type: 'string', maxLength: 100 },
              },
            },
            sourceMetadata: modelReleaseSourceMetadataSchema,
          },
        },
      },
    },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const key = idempotencyHeader(req.headers);
      if (!key) {
        return reply.code(400).send(idempotencyKeyRequiredError(req.id));
      }
      if (key.length > 200) {
        return reply.code(400).send(invalidIdempotencyKeyError(req.id));
      }

      const method = 'POST';
      const path = `/v1/tenants/${req.params.slug}/projects/${req.params.projectSlug}/attestations`;
      const hash = requestHash(req.body);
      const replay = await findReplay(db, {
        tenantId: tenant.id,
        apiKeyId: apiKey.id,
        method,
        path,
        key,
        requestHash: hash,
      });
      if (replay === 'conflict') {
        return reply.code(409).send(idempotencyKeyConflictError(req.id, key, method, path));
      }
      if (replay) {
        reply.code(replay.statusCode);
        return replay.responseBody;
      }

      if (!apiKey.createdByUserId) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              'api_key_actor_unavailable',
              'This API key no longer has a user actor for attestation creation.',
            ),
          );
      }

      const label = req.body.label.trim();
      const submittedSha256 = normalizeSha256(req.body.sha256);
      const sourceMetadata = req.body.sourceMetadata
        ? modelReleaseSourceMetadataFromBody(req.body.sourceMetadata, apiKey.createdByUserId)
        : null;
      const complianceSha256 = req.body.compliance
        ? normalizeSha256(req.body.compliance.sha256)
        : undefined;
      if (!label) {
        return reply
          .code(400)
          .send(
            publicError(req.id, 'invalid_label', 'Attestation label is required.', {
              fieldErrors: [publicFieldError('label', 'Attestation label is required.', 'required')],
            }),
          );
      }
      if (!SHA256_RE.test(submittedSha256)) {
        return reply
          .code(400)
          .send(
            publicError(req.id, 'invalid_sha256', 'sha256 must be 64 lowercase hex characters.', {
              fieldErrors: [
                publicFieldError(
                  'sha256',
                  'sha256 must be 64 lowercase hex characters.',
                  'pattern',
                ),
              ],
            }),
          );
      }
      if (req.body.sourceMetadata && !sourceMetadata) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'invalid_source_metadata',
              'sourceMetadata must describe a model release provenance record.',
              {
                fieldErrors: [
                  publicFieldError(
                    'sourceMetadata',
                    'sourceMetadata must describe a model release provenance record.',
                    'invalid',
                  ),
                ],
              },
            ),
          );
      }
      if (sourceMetadata && sourceMetadata.canonicalHash !== submittedSha256) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'source_metadata_hash_mismatch',
              'sourceMetadata.canonicalHash must match sha256.',
              {
                fieldErrors: [
                  publicFieldError(
                    'sourceMetadata.canonicalHash',
                    'sourceMetadata.canonicalHash must match sha256.',
                    'mismatch',
                  ),
                ],
              },
            ),
          );
      }
      if (complianceSha256 !== undefined && !SHA256_RE.test(complianceSha256)) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'invalid_compliance_sha256',
              'compliance.sha256 must be 64 lowercase hex characters.',
              {
                fieldErrors: [
                  publicFieldError(
                    'compliance.sha256',
                    'compliance.sha256 must be 64 lowercase hex characters.',
                    'pattern',
                  ),
                ],
              },
            ),
          );
      }
      if (complianceSha256 === submittedSha256) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'duplicate_compliance_sha256',
              'compliance.sha256 must be different from the primary sha256.',
            ),
          );
      }
      if (
        req.body.compliance?.mediaType !== undefined &&
        req.body.compliance.mediaType !== 'application/json'
      ) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'invalid_compliance_media_type',
              'compliance.mediaType must be application/json.',
              {
                fieldErrors: [
                  publicFieldError(
                    'compliance.mediaType',
                    'compliance.mediaType must be application/json.',
                    'enum',
                  ),
                ],
              },
            ),
          );
      }

      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.tenantId, tenant.id),
            eq(projects.slug, req.params.projectSlug),
            isNull(projects.archivedAt),
          ),
        )
        .limit(1);
      if (!project) {
        return reply.code(404).send(publicError(req.id, 'not_found', 'The project was not found.'));
      }

      const existing = await db
        .select({ id: attestations.id })
        .from(attestations)
        .where(and(eq(attestations.projectId, project.id), eq(attestations.label, label)))
        .limit(1);
      if (existing[0]) {
        return reply
          .code(409)
          .send(publicError(req.id, 'label_taken', 'An attestation already uses that label.'));
      }

      const perProjectCap = await checkAttestationsPerProjectLimit(db, project.id, tenant.plan);
      if (!perProjectCap.ok) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              perProjectCap.error,
              'The project attestation limit has been reached.',
            ),
          );
      }
      const monthlyCap = await checkMonthlyAttestationLimit(db, tenant.id, tenant.plan);
      if (!monthlyCap.ok) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              monthlyCap.error,
              'The monthly attestation limit has been reached.',
            ),
          );
      }
      const storageCap = await checkStorageLimit(
        db,
        tenant.id,
        tenant.plan,
        (req.body.byteSize ?? 0) + (req.body.compliance?.byteSize ?? 0),
      );
      if (!storageCap.ok) {
        return reply
          .code(413)
          .send(publicError(req.id, storageCap.error, 'The storage limit has been exceeded.'));
      }

      const { attestation, attempt } = await db.transaction(async (tx) => {
        const [att] = await tx
          .insert(attestations)
          .values({
            tenantId: tenant.id,
            projectId: project.id,
            label,
            description: req.body.description ?? null,
            createdByUserId: apiKey.createdByUserId!,
            createdByDeviceId: null,
            state: 'pending',
          })
          .returning();
        if (!att) throw new Error('failed to insert attestation');

        const [sub] = await tx
          .insert(submissionAttempts)
          .values({
            attestationId: att.id,
            state: 'pending',
            sourceMetadata: sourceMetadata ?? {},
          })
          .returning();
        if (!sub) throw new Error('failed to insert submission attempt');
        return { attestation: att, attempt: sub };
      });

      const leaves = [
        {
          leafType: LEAF_TYPES.fileSha256V1,
          canonicalPayloadHash: new Uint8Array(Buffer.from(submittedSha256, 'hex')),
          metadata: {
            source: sourceMetadata?.provider ?? 'public_api',
            ...(req.body.fileName ? { file_name: req.body.fileName } : {}),
            ...(req.body.byteSize !== undefined ? { byte_size: req.body.byteSize } : {}),
            ...(sourceMetadata?.provider === 'model_release'
              ? {
                  model_release: {
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
                    final_approver: sourceMetadata.finalApprover,
                    final_approval_timestamp: sourceMetadata.finalApprovalTimestamp,
                    disclosure_mode: sourceMetadata.disclosureMode,
                    verification_policy: sourceMetadata.verificationPolicy,
                  },
                }
              : {}),
          },
        },
        ...(complianceSha256
          ? [
              {
                leafType: LEAF_TYPES.fileSha256V1,
                canonicalPayloadHash: new Uint8Array(Buffer.from(complianceSha256, 'hex')),
                metadata: {
                  source: 'compliance_json',
                  media_type: req.body.compliance?.mediaType ?? 'application/json',
                  canonicalization: req.body.compliance?.canonicalization ?? 'json-stable-v1',
                  ...(req.body.compliance?.fileName
                    ? { file_name: req.body.compliance.fileName }
                    : {}),
                  ...(req.body.compliance?.byteSize !== undefined
                    ? { byte_size: req.body.compliance.byteSize }
                    : {}),
                },
              },
            ]
          : []),
      ];

      const manifest = buildManifest({
        tenantId: tenant.id,
        projectId: project.id,
        attestationId: attestation.id,
        attemptId: attempt.id,
        createdByUserId: apiKey.createdByUserId,
        createdByDeviceId: API_MANIFEST_DEVICE_ID,
        createdByProfileId: API_MANIFEST_PROFILE_ID,
        leaves,
        policyContext: {
          submission_channel: 'public_api',
          api_key_id: apiKey.id,
          ...(complianceSha256 ? { compliance_json_attached: true } : {}),
          ...(sourceMetadata ? { source_provider: sourceMetadata.provider } : {}),
        },
        sourceSummary: {
          file_count: leaves.length,
          shingle_count: 0,
          ocr_page_count: 0,
          ...(complianceSha256 ? { compliance_document_count: 1 } : {}),
          ...(sourceMetadata?.provider === 'model_release' ? { model_release_record_count: 1 } : {}),
        },
      });
      const signedManifest: Manifest = {
        ...manifest,
        signatures: [],
      };

      const objectKey = manifestKey(tenant.id, project.id, attestation.id, attempt.id);
      await putManifestJson(objectKey, JSON.stringify(signedManifest));
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(submissionAttempts)
          .set({
            state: 'uploaded',
            manifestObjectKey: objectKey,
            uploadedAt: now,
            updatedAt: now,
          })
          .where(eq(submissionAttempts.id, attempt.id));
        await tx
          .update(attestations)
          .set({ state: 'validating', updatedAt: now })
          .where(eq(attestations.id, attestation.id));
      });

      await enqueueValidation({
        attestationId: attestation.id,
        attemptId: attempt.id,
        requestId: req.id,
      });

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.attestationLifecycle,
        action: AUDIT_ACTIONS.attestationCreated,
        targetType: 'attestation',
        targetId: attestation.id,
        payload: {
          label,
          projectSlug: project.slug,
          apiKeyId: apiKey.id,
          submissionChannel: 'public_api',
          ...(complianceSha256 ? { complianceJsonAttached: true } : {}),
          ...(sourceMetadata ? { sourceProvider: sourceMetadata.provider } : {}),
        },
      });

      const responseBody = {
        data: publicAttestation(
          { ...attestation, state: 'validating', updatedAt: now },
          project,
          tenant,
        ),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
      await storeReplay(db, {
        tenantId: tenant.id,
        apiKey,
        method,
        path,
        key,
        requestHash: hash,
        statusCode: 202,
        responseBody,
      });

      reply.code(202);
      return responseBody;
    },
  );

  app.get<{
    Params: { slug: string };
    Querystring: { project?: string; status?: string; limit?: string; offset?: string };
  }>('/v1/tenants/:slug/attestations', { preHandler: requireApiKey }, async (req, reply) => {
    if (!ensureTenantSlug(req, reply)) return;
    const tenant = req.currentApiKeyTenant!;
    const limit = parseBoundedInt(req.query.limit, 100, 1, 500);
    const offset = parseBoundedInt(req.query.offset, 0, 0, 10_000);
    const filters: SQL[] = [eq(attestations.tenantId, tenant.id)];
    if (req.query.project) {
      filters.push(eq(projects.slug, req.query.project));
    }
    if (req.query.status) {
      filters.push(eq(attestations.state, req.query.status));
    }
    const fetchedRows = await db
      .select({ attestation: attestations, project: projects })
      .from(attestations)
      .innerJoin(projects, eq(projects.id, attestations.projectId))
      .where(and(...filters))
      .orderBy(desc(attestations.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const { rows, hasMore } = pageRows(fetchedRows, limit);

    return {
      data: rows.map((row) => publicAttestation(row.attestation, row.project, tenant)),
      meta: {
        requestId: req.id,
        apiKeyId: (req.currentApiKey as ApiKey).id,
        limit,
        offset,
        pagination: paginationMeta(limit, offset, rows.length, hasMore),
      },
    };
  });

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/tenants/:slug/attestations/:id',
    { preHandler: requireApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const [row] = await db
        .select({ attestation: attestations, project: projects })
        .from(attestations)
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .where(and(eq(attestations.tenantId, tenant.id), eq(attestations.id, req.params.id)))
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The attestation was not found.'));
      }

      return {
        data: publicAttestation(row.attestation, row.project, tenant),
        meta: { requestId: req.id, apiKeyId: (req.currentApiKey as ApiKey).id },
      };
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/tenants/:slug/attestations/:id/receipt',
    { preHandler: requireApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const [row] = await db
        .select({
          id: attestations.id,
          label: attestations.label,
          state: attestations.state,
          merkleRoot: attestations.merkleRoot,
          packageId: attestations.packageId,
          receiptAvailable: attestations.receiptJsonObjectKey,
          receiptPdfAvailable: attestations.receiptPdfObjectKey,
          confirmedAt: attestations.confirmedAt,
        })
        .from(attestations)
        .where(and(eq(attestations.tenantId, tenant.id), eq(attestations.id, req.params.id)))
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The attestation was not found.'));
      }
      if (!row.receiptAvailable) {
        return reply
          .code(404)
          .send(
            publicError(req.id, 'receipt_not_available', 'The receipt is not available yet.', true),
          );
      }

      return {
        data: {
          attestationId: row.id,
          attestationLabel: row.label,
          state: row.state,
          packageId: row.packageId,
          merkleRoot: row.merkleRoot,
          receiptAvailable: true,
          receiptPdfAvailable: row.receiptPdfAvailable !== null,
          confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
        },
        meta: { requestId: req.id, apiKeyId: (req.currentApiKey as ApiKey).id },
      };
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/tenants/:slug/attestations/:id/receipt.json',
    { preHandler: requireApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const [row] = await db
        .select({
          receiptJsonObjectKey: attestations.receiptJsonObjectKey,
        })
        .from(attestations)
        .where(and(eq(attestations.tenantId, tenant.id), eq(attestations.id, req.params.id)))
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The attestation was not found.'));
      }
      if (!row.receiptJsonObjectKey) {
        return reply
          .code(404)
          .send(
            publicError(req.id, 'receipt_not_available', 'The receipt is not available yet.', true),
          );
      }

      const receiptText = await readArtifactJson(row.receiptJsonObjectKey);
      return reply
        .header('content-type', 'application/json')
        .header('content-disposition', `attachment; filename="${req.params.id}.receipt.json"`)
        .send(receiptText);
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/v1/tenants/:slug/attestations/:id/receipt.pdf',
    { preHandler: requireApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const [row] = await db
        .select({
          receiptJsonObjectKey: attestations.receiptJsonObjectKey,
          receiptPdfObjectKey: attestations.receiptPdfObjectKey,
        })
        .from(attestations)
        .where(and(eq(attestations.tenantId, tenant.id), eq(attestations.id, req.params.id)))
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The attestation was not found.'));
      }
      if (!row.receiptJsonObjectKey) {
        return reply
          .code(404)
          .send(
            publicError(req.id, 'receipt_not_available', 'The receipt is not available yet.', true),
          );
      }
      if (!row.receiptPdfObjectKey) {
        return reply
          .code(404)
          .send(
            publicError(
              req.id,
              'receipt_pdf_not_available',
              'The receipt PDF is not available yet.',
              true,
            ),
          );
      }

      const bytes = await readArtifactBytes(row.receiptPdfObjectKey);
      if (!bytes) {
        return reply
          .code(404)
          .send(
            publicError(
              req.id,
              'receipt_pdf_not_available',
              'The receipt PDF is not available yet.',
              true,
            ),
          );
      }

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${req.params.id}.receipt.pdf"`)
        .send(bytes);
    },
  );

  app.post<{
    Params: { slug: string; id: string };
    Body: {
      submittedHash?: string;
      candidateHashes?: string[];
      lookupKind?: 'whole_file' | 'content' | 'exact_image' | 'any';
    };
  }>(
    '/v1/tenants/:slug/attestations/:id/lookup',
    {
      preHandler: requireApiKey,
      schema: {
        body: {
          type: 'object',
          anyOf: [{ required: ['submittedHash'] }, { required: ['candidateHashes'] }],
          additionalProperties: false,
          properties: {
            submittedHash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
            candidateHashes: {
              type: 'array',
              minItems: 1,
              maxItems: 10000,
              items: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
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
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const [row] = await db
        .select({ attestation: attestations, project: projects })
        .from(attestations)
        .innerJoin(projects, eq(projects.id, attestations.projectId))
        .where(and(eq(attestations.tenantId, tenant.id), eq(attestations.id, req.params.id)))
        .limit(1);

      if (!row || row.attestation.state !== 'confirmed') {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The attestation was not found.'));
      }

      const lookupBody = req.body;
      const candidateHashes = lookupBody.candidateHashes
        ? [...new Set(lookupBody.candidateHashes.map((hash) => normalizeSha256(hash)))]
        : [];
      const submittedHash = lookupBody.submittedHash
        ? normalizeSha256(lookupBody.submittedHash)
        : candidateHashes[0];
      if (!submittedHash || !SHA256_RE.test(submittedHash)) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'invalid_sha256',
              'submittedHash must be 64 lowercase hex characters.',
              {
                fieldErrors: [
                  publicFieldError(
                    'submittedHash',
                    'submittedHash must be 64 lowercase hex characters.',
                    'pattern',
                  ),
                ],
              },
            ),
          );
      }
      if (candidateHashes.some((hash) => !SHA256_RE.test(hash))) {
        return reply
          .code(400)
          .send(
            publicError(
              req.id,
              'invalid_sha256',
              'candidateHashes must contain 64 lowercase hex characters.',
              {
                fieldErrors: [
                  publicFieldError(
                    'candidateHashes',
                    'candidateHashes must contain 64 lowercase hex characters.',
                    'pattern',
                  ),
                ],
              },
            ),
          );
      }

      const lookupKind = lookupBody.lookupKind ?? (candidateHashes.length > 0 ? 'content' : 'any');
      const submittedHashSet = new Set(
        lookupKind === 'content' ? candidateHashes : [submittedHash],
      );
      const attestation = row.attestation;
      if (!attestation.confirmedAttemptId || !attestation.manifestObjectKey) {
        return reply
          .code(500)
          .send(
            publicError(
              req.id,
              'attestation_state_inconsistent',
              'The attestation is missing confirmed manifest metadata.',
              true,
            ),
          );
      }

      const manifest = JSON.parse(
        await readArtifactJson(attestation.manifestObjectKey),
      ) as Manifest;
      const matchedLeaf = manifest.leaf_set.find(
        (leaf) =>
          submittedHashSet.has(leaf.canonical_payload_hash) &&
          leafMatchesLookupKind(leaf, lookupKind),
      );
      const resultSubmittedHash = matchedLeaf?.canonical_payload_hash ?? submittedHash;
      const packageId = `pkg_${randomBytes(16).toString('hex')}`;
      const resultObjectKey = lookupResultKey(
        attestation.tenantId,
        attestation.projectId,
        attestation.id,
        packageId,
      );
      const attestationCtx = {
        label: attestation.label,
        confirmed_at: attestation.confirmedAt ? attestation.confirmedAt.toISOString() : '',
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
          return reply
            .code(500)
            .send(
              publicError(
                req.id,
                'manifest_unknown_leaf_type',
                'The manifest contains an unsupported leaf type.',
              ),
            );
        }
        const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));
        const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
        const recomputed = computeLeafHash({
          protocolVersion: '1.0',
          leafType: matchedLeaf.leaf_type as LeafType,
          hashAlgorithm: 'sha256',
          canonicalPayloadHash: fromHex(matchedLeaf.canonical_payload_hash),
        });
        if (toHex(recomputed) !== matchedLeaf.leaf_hash) {
          return reply
            .code(500)
            .send(
              publicError(
                req.id,
                'manifest_leaf_hash_inconsistent',
                'The manifest leaf hash is inconsistent.',
              ),
            );
        }
        const proofSteps = buildMerkleProof(
          manifest.leaf_set.map((leaf) => fromHex(leaf.leaf_hash)),
          fromHex(matchedLeaf.leaf_hash),
        );
        pkg = buildMatchResultPackage({
          packageId,
          submittedHash: resultSubmittedHash,
          lookupScope: scope,
          attestation: attestationCtx,
          match: {
            leaf_id: matchedLeaf.leaf_hash,
            leaf_type: matchedLeaf.leaf_type,
            ...matchMetadata(matchedLeaf.metadata),
            proof_path: proofSteps.map((step) => ({
              sibling: toHex(step.sibling),
              position: step.position,
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
      await putManifestJson(resultObjectKey, JSON.stringify(finalPkg, null, 2));
      await db.insert(verificationResults).values({
        packageId,
        attestationId: attestation.id,
        tenantId: attestation.tenantId,
        lookedUpByUserId: apiKey.createdByUserId,
        resultType: finalPkg.result_type,
        submittedHash: resultSubmittedHash,
        resultObjectKey,
        signed: signed ? 'true' : 'false',
      });
      const linkId = await issueVerificationLink(db, {
        tenantId: attestation.tenantId,
        targetType: 'lookup_result',
        targetRef: packageId,
        createdByUserId: apiKey.createdByUserId,
      });
      try {
        await enqueuePdf({ linkId, requestId: req.id });
      } catch {
        // Lookup packages remain valid if async PDF rendering is delayed.
      }

      await writeAuditEvent(db, {
        tenantId: attestation.tenantId,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.verificationLookup,
        action: AUDIT_ACTIONS.verificationLookupPerformed,
        targetType: 'attestation',
        targetId: attestation.id,
        payload: {
          apiKeyId: apiKey.id,
          packageId,
          linkId,
          resultType: finalPkg.result_type,
          signed,
          lookupKind,
        },
      });

      reply.code(201);
      return {
        data: {
          package: finalPkg,
          packageId,
          linkId,
          signed,
          retrieveUrl: `/lookup-results/${packageId}`,
          verificationUrl: `/v/${linkId}`,
        },
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
    },
  );

  app.post<{
    Params: { slug: string; id: string };
    Body: { email: string; message?: string };
  }>(
    '/v1/tenants/:slug/attestations/:id/verifier-access',
    {
      preHandler: requireWriteApiKey,
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
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const key = idempotencyHeader(req.headers);
      if (!key) {
        return reply.code(400).send(idempotencyKeyRequiredError(req.id));
      }
      if (key.length > 200) {
        return reply.code(400).send(invalidIdempotencyKeyError(req.id));
      }

      const method = 'POST';
      const path = `/v1/tenants/${req.params.slug}/attestations/${req.params.id}/verifier-access`;
      const hash = requestHash(req.body);
      const replay = await findReplay(db, {
        tenantId: tenant.id,
        apiKeyId: apiKey.id,
        method,
        path,
        key,
        requestHash: hash,
      });
      if (replay === 'conflict') {
        return reply.code(409).send(idempotencyKeyConflictError(req.id, key, method, path));
      }
      if (replay) {
        reply.code(replay.statusCode);
        return replay.responseBody;
      }
      if (!apiKey.createdByUserId) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              'api_key_actor_unavailable',
              'This API key no longer has a user actor for verifier access management.',
            ),
          );
      }

      const email = req.body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply
          .code(400)
          .send(
            publicError(req.id, 'invalid_email', 'A valid verifier email is required.', {
              fieldErrors: [
                publicFieldError('email', 'A valid verifier email is required.', 'format'),
              ],
            }),
          );
      }

      const [attestation] = await db
        .select()
        .from(attestations)
        .where(and(eq(attestations.tenantId, tenant.id), eq(attestations.id, req.params.id)))
        .limit(1);
      if (!attestation) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The attestation was not found.'));
      }

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
        const responseBody = {
          data: publicAccessGrant(existing[0]),
          meta: { requestId: req.id, apiKeyId: apiKey.id },
        };
        await storeReplay(db, {
          tenantId: tenant.id,
          apiKey,
          method,
          path,
          key,
          requestHash: hash,
          statusCode: 200,
          responseBody,
        });
        reply.code(200);
        return responseBody;
      }

      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      const tokenPair = targetUser ? null : generateToken();
      const [grant] = await db
        .insert(attestationAccessGrants)
        .values({
          attestationId: attestation.id,
          tenantId: tenant.id,
          grantedToEmail: email,
          grantedToUserId: targetUser ? targetUser.id : null,
          tokenHash: tokenPair ? tokenPair.hash : null,
          claimedAt: targetUser ? new Date() : null,
          grantedByUserId: apiKey.createdByUserId,
        })
        .returning();
      if (!grant) throw app.httpErrors.internalServerError();

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessGranted,
        targetType: 'attestation_access_grant',
        targetId: grant.id,
        payload: {
          attestationId: attestation.id,
          grantedToEmail: email,
          apiKeyId: apiKey.id,
          message: req.body.message?.trim() || null,
          pending: tokenPair !== null,
        },
      });

      const responseBody = {
        data: publicAccessGrant(grant, tokenPair?.token),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
      await storeReplay(db, {
        tenantId: tenant.id,
        apiKey,
        method,
        path,
        key,
        requestHash: hash,
        statusCode: 201,
        responseBody,
      });

      reply.code(201);
      return responseBody;
    },
  );

  app.delete<{
    Params: { slug: string; id: string; grantId: string };
  }>(
    '/v1/tenants/:slug/attestations/:id/verifier-access/:grantId',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      if (!apiKey.createdByUserId) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              'api_key_actor_unavailable',
              'This API key no longer has a user actor for verifier access management.',
            ),
          );
      }

      const [grant] = await db
        .select({
          grant: attestationAccessGrants,
          attestationTenantId: attestations.tenantId,
        })
        .from(attestationAccessGrants)
        .innerJoin(attestations, eq(attestations.id, attestationAccessGrants.attestationId))
        .where(
          and(
            eq(attestationAccessGrants.id, req.params.grantId),
            eq(attestationAccessGrants.attestationId, req.params.id),
            eq(attestations.tenantId, tenant.id),
          ),
        )
        .limit(1);
      if (!grant) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The verifier access grant was not found.'));
      }
      if (grant.grant.revokedAt) {
        return reply
          .code(409)
          .send(
            publicError(req.id, 'already_revoked', 'The verifier access grant is already revoked.'),
          );
      }

      await db
        .update(attestationAccessGrants)
        .set({ revokedAt: new Date() })
        .where(eq(attestationAccessGrants.id, grant.grant.id));

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.accessControl,
        action: AUDIT_ACTIONS.attestationAccessRevoked,
        targetType: 'attestation_access_grant',
        targetId: grant.grant.id,
        payload: { attestationId: req.params.id, apiKeyId: apiKey.id },
      });

      reply.code(204).send();
    },
  );

  app.get<{
    Params: { slug: string };
    Querystring: {
      category?: string;
      action?: string;
      targetType?: string;
      targetId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/v1/tenants/:slug/events', { preHandler: requireApiKey }, async (req, reply) => {
    if (!ensureTenantSlug(req, reply)) return;
    const tenant = req.currentApiKeyTenant!;
    const limit = parseBoundedInt(req.query.limit, 100, 1, 500);
    const offset = parseBoundedInt(req.query.offset, 0, 0, 10_000);
    const filters: SQL[] = [eq(auditEvents.tenantId, tenant.id)];
    if (req.query.category) {
      filters.push(eq(auditEvents.category, req.query.category));
    }
    if (req.query.action) {
      filters.push(eq(auditEvents.action, req.query.action));
    }
    if (req.query.targetType) {
      filters.push(eq(auditEvents.targetType, req.query.targetType));
    }
    if (req.query.targetId) {
      filters.push(eq(auditEvents.targetId, req.query.targetId));
    }
    const fetchedRows = await db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const { rows, hasMore } = pageRows(fetchedRows, limit);

    return {
      data: rows.map(publicEvent),
      meta: {
        requestId: req.id,
        apiKeyId: (req.currentApiKey as ApiKey).id,
        limit,
        offset,
        pagination: paginationMeta(limit, offset, rows.length, hasMore),
      },
    };
  });

  app.get<{ Params: { slug: string }; Querystring: { limit?: string; offset?: string } }>(
    '/v1/tenants/:slug/webhook-endpoints',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const limit = parseBoundedInt(req.query.limit, 100, 1, 500);
      const offset = parseBoundedInt(req.query.offset, 0, 0, 10_000);
      const fetchedRows = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.tenantId, tenant.id))
        .orderBy(desc(webhookEndpoints.createdAt))
        .limit(limit + 1)
        .offset(offset);
      const { rows, hasMore } = pageRows(fetchedRows, limit);
      return {
        data: rows.map((row) => publicWebhookEndpoint(row)),
        meta: {
          requestId: req.id,
          apiKeyId: (req.currentApiKey as ApiKey).id,
          pagination: paginationMeta(limit, offset, rows.length, hasMore),
        },
      };
    },
  );

  app.post<{
    Params: { slug: string };
    Body: { url: string; description?: string; events: string[] };
  }>(
    '/v1/tenants/:slug/webhook-endpoints',
    {
      preHandler: requireWriteApiKey,
      schema: {
        body: {
          type: 'object',
          required: ['url', 'events'],
          additionalProperties: false,
          properties: {
            url: { type: 'string', minLength: 1, maxLength: 2000 },
            description: { type: 'string', maxLength: 1000 },
            events: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', enum: WEBHOOK_SUPPORTED_EVENTS as unknown as string[] },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const idem = await prepareIdempotentWrite({
        db,
        req,
        reply,
        tenant,
        apiKey,
        path: `/v1/tenants/${req.params.slug}/webhook-endpoints`,
      });
      if (!idem) return;
      if (idem.replay) {
        reply.code(idem.replay.statusCode);
        return idem.replay.responseBody;
      }
      if (!apiKey.createdByUserId) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              'api_key_actor_unavailable',
              'This API key no longer has a user actor for webhook configuration.',
            ),
          );
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(req.body.url);
      } catch {
        return reply
          .code(400)
          .send(publicError(req.id, 'invalid_webhook_url', 'Webhook URL is invalid.'));
      }
      if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
        return reply
          .code(400)
          .send(publicError(req.id, 'invalid_webhook_url', 'Webhook URL must use http or https.'));
      }
      if (req.body.events.some((event) => !isWebhookEventType(event))) {
        return reply
          .code(400)
          .send(publicError(req.id, 'invalid_webhook_event', 'Webhook event is not supported.'));
      }

      const secret = generateWebhookSecret();
      const [endpoint] = await db
        .insert(webhookEndpoints)
        .values({
          tenantId: tenant.id,
          url: parsedUrl.toString(),
          description: req.body.description ?? null,
          events: [...new Set(req.body.events)],
          signingSecret: secret,
          createdByUserId: apiKey.createdByUserId,
        })
        .returning();
      if (!endpoint) throw app.httpErrors.internalServerError();

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.apiSdkWebhook,
        action: 'webhook_endpoint.created',
        targetType: 'webhook_endpoint',
        targetId: endpoint.id,
        payload: { url: endpoint.url, events: endpoint.events, apiKeyId: apiKey.id },
      });

      const responseBody = {
        data: publicWebhookEndpoint(endpoint, secret),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
      await storeReplay(db, {
        tenantId: tenant.id,
        apiKey,
        method: idem.method,
        path: idem.path,
        key: idem.key,
        requestHash: idem.requestHash,
        statusCode: 201,
        responseBody,
      });

      reply.code(201);
      return responseBody;
    },
  );

  app.delete<{ Params: { slug: string; endpointId: string } }>(
    '/v1/tenants/:slug/webhook-endpoints/:endpointId',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const [endpoint] = await db
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.tenantId, tenant.id),
            eq(webhookEndpoints.id, req.params.endpointId),
          ),
        )
        .limit(1);
      if (!endpoint) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The webhook endpoint was not found.'));
      }
      if (endpoint.disabledAt) {
        return reply
          .code(409)
          .send(
            publicError(req.id, 'already_disabled', 'The webhook endpoint is already disabled.'),
          );
      }
      await db
        .update(webhookEndpoints)
        .set({ disabledAt: new Date(), updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, endpoint.id));
      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.apiSdkWebhook,
        action: 'webhook_endpoint.disabled',
        targetType: 'webhook_endpoint',
        targetId: endpoint.id,
        payload: { apiKeyId: apiKey.id },
      });
      reply.code(204).send();
    },
  );

  app.post<{ Params: { slug: string; endpointId: string } }>(
    '/v1/tenants/:slug/webhook-endpoints/:endpointId/test',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const idem = await prepareIdempotentWrite({
        db,
        req,
        reply,
        tenant,
        apiKey,
        path: `/v1/tenants/${req.params.slug}/webhook-endpoints/${req.params.endpointId}/test`,
      });
      if (!idem) return;
      if (idem.replay) {
        reply.code(idem.replay.statusCode);
        return idem.replay.responseBody;
      }
      const [endpoint] = await db
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.tenantId, tenant.id),
            eq(webhookEndpoints.id, req.params.endpointId),
            isNull(webhookEndpoints.disabledAt),
          ),
        )
        .limit(1);
      if (!endpoint) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The webhook endpoint was not found.'));
      }

      const now = new Date();
      const payload = {
        id: `evt_test_${endpoint.id.replace(/-/g, '')}`,
        type: 'webhook.test',
        tenantId: tenant.id,
        createdAt: now.toISOString(),
        data: {
          endpointId: endpoint.id,
          message: 'Proveria webhook test event',
        },
      };
      const body = JSON.stringify(payload);
      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          tenantId: tenant.id,
          endpointId: endpoint.id,
          eventType: 'webhook.test',
          payload,
          signature: signWebhookPayload(endpoint.signingSecret, now.toISOString(), body),
          status: 'pending',
          nextAttemptAt: now,
        })
        .returning();
      if (!delivery) throw app.httpErrors.internalServerError();

      await enqueueWebhook({ deliveryId: delivery.id, requestId: req.id });
      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.apiSdkWebhook,
        action: 'webhook_delivery.test_enqueued',
        targetType: 'webhook_delivery',
        targetId: delivery.id,
        payload: { endpointId: endpoint.id, apiKeyId: apiKey.id },
      });

      const responseBody = {
        data: publicWebhookDelivery(delivery),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
      await storeReplay(db, {
        tenantId: tenant.id,
        apiKey,
        method: idem.method,
        path: idem.path,
        key: idem.key,
        requestHash: idem.requestHash,
        statusCode: 202,
        responseBody,
      });

      reply.code(202);
      return responseBody;
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { limit?: string; offset?: string } }>(
    '/v1/tenants/:slug/webhook-deliveries',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const limit = parseBoundedInt(req.query.limit, 100, 1, 500);
      const offset = parseBoundedInt(req.query.offset, 0, 0, 10_000);
      const fetchedRows = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.tenantId, tenant.id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit + 1)
        .offset(offset);
      const { rows, hasMore } = pageRows(fetchedRows, limit);
      return {
        data: rows.map(publicWebhookDelivery),
        meta: {
          requestId: req.id,
          apiKeyId: (req.currentApiKey as ApiKey).id,
          limit,
          offset,
          pagination: paginationMeta(limit, offset, rows.length, hasMore),
        },
      };
    },
  );

  app.get<{
    Params: { slug: string };
    Querystring: {
      projectId?: string;
      actorUserId?: string;
      includeEvents?: string;
      limit?: string;
    };
  }>(
    '/v1/tenants/:slug/evidence-export/manifest',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const manifest = await buildPublicEvidenceExportManifest({
        tenant,
        query: req.query,
      });

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.evidenceExport,
        action: AUDIT_ACTIONS.evidenceExportCreated,
        targetType: 'evidence_export_manifest',
        payload: {
          filters: manifest.export.filters,
          counts: manifest.export.counts,
          apiKeyId: apiKey.id,
        },
      });

      return {
        data: manifest,
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
    },
  );

  app.get<{
    Params: { slug: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    '/v1/tenants/:slug/evidence-export/jobs',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const limit = parseBoundedInt(req.query.limit, 25, 1, 100);
      const offset = parseBoundedInt(req.query.offset, 0, 0, 10_000);
      const fetchedRows = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.tenantId, tenant.id))
        .orderBy(desc(exportJobs.createdAt))
        .limit(limit + 1)
        .offset(offset);
      const { rows, hasMore } = pageRows(fetchedRows, limit);
      return {
        data: rows.map(publicExportJob),
        meta: {
          requestId: req.id,
          apiKeyId: (req.currentApiKey as ApiKey).id,
          limit,
          offset,
          pagination: paginationMeta(limit, offset, rows.length, hasMore),
        },
      };
    },
  );

  app.get<{
    Params: { slug: string; jobId: string };
  }>(
    '/v1/tenants/:slug/evidence-export/jobs/:jobId',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const [job] = await db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, tenant.id), eq(exportJobs.id, req.params.jobId)))
        .limit(1);
      if (!job) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The evidence export job was not found.'));
      }
      return {
        data: publicExportJobWithManifest(job),
        meta: {
          requestId: req.id,
          apiKeyId: (req.currentApiKey as ApiKey).id,
        },
      };
    },
  );

  app.get<{
    Params: { slug: string; jobId: string };
  }>(
    '/v1/tenants/:slug/evidence-export/jobs/:jobId/bundle',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const [job] = await db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, tenant.id), eq(exportJobs.id, req.params.jobId)))
        .limit(1);
      if (!job) {
        return reply
          .code(404)
          .send(publicError(req.id, 'not_found', 'The evidence export job was not found.'));
      }
      if (!job.resultObjectKey) {
        return reply
          .code(404)
          .send(
            publicError(
              req.id,
              'bundle_not_available',
              'The evidence export bundle is not available.',
            ),
          );
      }
      const bytes = await readArtifactBytes(job.resultObjectKey);
      if (!bytes) {
        return reply
          .code(404)
          .send(
            publicError(
              req.id,
              'bundle_not_available',
              'The evidence export bundle is not available.',
            ),
          );
      }
      return reply
        .header('content-type', 'application/json')
        .header(
          'content-disposition',
          `attachment; filename="proveria-evidence-bundle-${job.id}.json"`,
        )
        .send(bytes);
    },
  );

  app.post<{
    Params: { slug: string };
  }>(
    '/v1/tenants/:slug/evidence-export/jobs/cleanup-expired',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const result = await cleanupExpiredEvidenceExports({
        db,
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        deleteObject: removeObject,
      });
      return {
        data: result,
        meta: {
          requestId: req.id,
          apiKeyId: apiKey.id,
        },
      };
    },
  );

  app.post<{
    Params: { slug: string };
    Body: {
      projectId?: string;
      actorUserId?: string;
      includeEvents?: boolean;
      limit?: number;
    };
  }>(
    '/v1/tenants/:slug/evidence-export/jobs',
    { preHandler: requireWriteApiKey },
    async (req, reply) => {
      if (!ensureTenantSlug(req, reply)) return;
      const tenant = req.currentApiKeyTenant!;
      const apiKey = req.currentApiKey as ApiKey;
      const idem = await prepareIdempotentWrite({
        db,
        req,
        reply,
        tenant,
        apiKey,
        path: `/v1/tenants/${req.params.slug}/evidence-export/jobs`,
      });
      if (!idem) return;
      if (idem.replay) {
        reply.code(idem.replay.statusCode);
        return idem.replay.responseBody;
      }
      if (!apiKey.createdByUserId) {
        return reply
          .code(409)
          .send(
            publicError(
              req.id,
              'api_key_actor_unavailable',
              'This API key no longer has a user actor for evidence export.',
            ),
          );
      }

      const manifest = await buildPublicEvidenceExportManifest({
        tenant,
        query: {
          projectId: req.body?.projectId,
          actorUserId: req.body?.actorUserId,
          includeEvents: req.body?.includeEvents === false ? 'false' : 'true',
          limit: typeof req.body?.limit === 'number' ? String(req.body.limit) : undefined,
        },
        type: 'evidence_export_job_manifest',
      });
      const artifactCount = manifest.attestations.reduce(
        (count, attestation) => count + Object.values(attestation.artifacts).filter(Boolean).length,
        0,
      );
      const rowCount =
        manifest.attestations.length +
        manifest.attempts.length +
        manifest.verificationResults.length +
        manifest.verificationLinks.length +
        manifest.events.length;
      const [job] = await db
        .insert(exportJobs)
        .values({
          tenantId: tenant.id,
          createdByUserId: apiKey.createdByUserId,
          kind: 'evidence_bundle',
          status: 'queued',
          filters: manifest.export.filters,
          manifest,
          artifactCount,
          rowCount,
          progressPercent: 0,
          retryCount: 0,
          maxRetries: EXPORT_JOB_MAX_RETRIES,
          expiresAt: daysFromNow(EXPORT_JOB_RETENTION_DAYS),
          retentionPolicy: {
            retention_days: EXPORT_JOB_RETENTION_DAYS,
            delete_after_expiration: true,
          },
        })
        .returning();
      if (!job) throw app.httpErrors.internalServerError();

      await enqueueExport({ jobId: job.id, requestId: req.id });

      await writeAuditEvent(db, {
        tenantId: tenant.id,
        actorUserId: apiKey.createdByUserId,
        category: AUDIT_CATEGORIES.evidenceExport,
        action: AUDIT_ACTIONS.evidenceExportCreated,
        targetType: 'evidence_export_job',
        targetId: job.id,
        payload: {
          filters: manifest.export.filters,
          artifactCount,
          rowCount,
          apiKeyId: apiKey.id,
          queued: true,
        },
      });

      const responseBody = {
        data: publicExportJobWithManifest(job),
        meta: { requestId: req.id, apiKeyId: apiKey.id },
      };
      await storeReplay(db, {
        tenantId: tenant.id,
        apiKey,
        method: idem.method,
        path: idem.path,
        key: idem.key,
        requestHash: idem.requestHash,
        statusCode: 201,
        responseBody,
      });

      reply.code(201);
      return responseBody;
    },
  );
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
    ...(Number.isInteger(md.source_index) ? { source_index: md.source_index as number } : {}),
    ...(typeof md.component_method === 'string' ? { component_method: md.component_method } : {}),
    ...(typeof md.media_type === 'string' ? { media_type: md.media_type } : {}),
  };
};

const leafMatchesLookupKind = (
  leaf: Manifest['leaf_set'][number],
  lookupKind: 'whole_file' | 'content' | 'exact_image' | 'any',
): boolean => {
  if (lookupKind === 'any') return true;
  if (lookupKind === 'whole_file') return leaf.leaf_type === LEAF_TYPES.fileSha256V1;
  if (lookupKind === 'content') return leaf.leaf_type === LEAF_TYPES.shingleSha256V1;
  const md = leaf.metadata as { component_method?: unknown };
  return (
    leaf.leaf_type === LEAF_TYPES.componentSha256V1 &&
    md.component_method === 'exact-image-sha256/v1'
  );
};
