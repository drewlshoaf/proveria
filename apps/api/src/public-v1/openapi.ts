const sampleProject = {
  id: '018f8f2a-1111-7111-9111-111111111111',
  slug: 'evaluation-evidence',
  name: 'Evaluation Evidence',
  workspace: {
    id: '018f8f2a-0000-7000-9000-000000000000',
    slug: 'evaluation-workspace',
    name: 'Evaluation Workspace',
  },
  description: null,
  classification: null,
  tags: [],
  visibility: 'private',
  createdAt: '2026-06-05T12:00:00.000Z',
  archivedAt: null,
};

const sampleAttestation = {
  id: '018f8f2a-2222-7222-9222-222222222222',
  label: 'invoice-2026-05',
  description: null,
  state: 'confirmed',
  workspace: sampleProject.workspace,
  project: {
    id: sampleProject.id,
    slug: sampleProject.slug,
    name: sampleProject.name,
  },
  merkleRoot: '1b171f6e8cca90e64ebab6011ac5644a64a59e630da145abffb2c22392b1a511',
  packageId: 'pkg_d41ea473ca56354f4e4030686553fdfb',
  receiptAvailable: true,
  createdAt: '2026-06-05T12:01:00.000Z',
  confirmedAt: '2026-06-05T12:01:30.000Z',
};

const sampleMeta = {
  requestId: 'req_018f8f2a_example',
  apiKeyId: '018f8f2a-9999-7999-9999-999999999999',
};

const sampleApiKeyCredential = {
  id: sampleMeta.apiKeyId,
  keyPrefix: 'prv_v1_example',
  scopes: ['read', 'write'],
  workspace: sampleProject.workspace,
  createdAt: '2026-06-05T11:55:00.000Z',
  expiresAt: '2026-09-03T11:55:00.000Z',
  lastUsedAt: '2026-06-05T12:00:00.000Z',
  usageCount: 12,
  lastUsedMethod: 'GET',
  lastUsedPath: '/v1/tenants/:slug/projects',
  lastUsedStatusCode: 200,
};

const jsonEnvelope = (schemaRef: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { $ref: schemaRef },
        meta: { $ref: '#/components/schemas/Meta' },
      },
    },
  },
});

const jsonArrayEnvelope = (schemaRef: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: schemaRef } },
        meta: { $ref: '#/components/schemas/Meta' },
      },
    },
  },
});

const jsonPaginatedArrayEnvelope = (schemaRef: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: schemaRef } },
        meta: {
          allOf: [
            { $ref: '#/components/schemas/Meta' },
            {
              type: 'object',
              required: ['pagination'],
              properties: {
                pagination: { $ref: '#/components/schemas/Pagination' },
              },
            },
          ],
        },
      },
    },
  },
});

const rateLimitResponseHeaders = {
  'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
  'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
  'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
};

const limitParameter = (maximum = 500, defaultValue = 100) => ({
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum, default: defaultValue },
});

const offsetParameter = {
  name: 'offset',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
};

export const publicV1OpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'Proveria Public API',
    version: 'v1',
    description:
      'Public API for workspace-scoped read, hash-attestation, verifier access, events, and webhook workflows using workspace-bound API keys. The {slug} path segment names the workspace slug while preserving the stable /tenants path.',
  },
  servers: [{ url: 'http://127.0.0.1:3001' }],
  components: {
    securitySchemes: {
      bearerApiKey: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Workspace-bound API key. Revoked or expired keys are rejected. Example: Bearer prv_v1_...',
      },
    },
    headers: {
      RateLimitLimit: {
        description:
          'Maximum authenticated public API requests allowed in the current policy window.',
        schema: { type: 'integer', example: 600 },
      },
      RateLimitRemaining: {
        description:
          'Remaining authenticated public API requests available in the current policy window. During the initial V6 publication period this may equal RateLimit-Limit before strict enforcement is enabled.',
        schema: { type: 'integer', example: 600 },
      },
      RateLimitReset: {
        description:
          'Unix timestamp in seconds when the current public API rate-limit policy window resets.',
        schema: { type: 'integer', example: 1780689660 },
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'retryable', 'requestId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              retryable: { type: 'boolean' },
              requestId: { type: 'string' },
              fieldErrors: {
                type: 'array',
                items: { $ref: '#/components/schemas/FieldError' },
              },
              details: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
      FieldError: {
        type: 'object',
        required: ['field', 'message'],
        properties: {
          field: {
            type: 'string',
            description:
              'Request field or header name using dot notation for nested JSON fields.',
            example: 'compliance.sha256',
          },
          message: { type: 'string', example: 'sha256 must be 64 lowercase hex characters.' },
          code: {
            type: 'string',
            description: 'Machine-readable validation keyword when available.',
            example: 'pattern',
          },
        },
      },
      Error: {
        type: 'object',
        required: ['code', 'message', 'retryable', 'requestId'],
        properties: {
          code: { type: 'string', example: 'not_found' },
          message: { type: 'string', example: 'The requested resource was not found.' },
          retryable: { type: 'boolean', example: false },
          requestId: { type: 'string', example: sampleMeta.requestId },
          fieldErrors: {
            type: 'array',
            items: { $ref: '#/components/schemas/FieldError' },
          },
          details: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      Meta: {
        type: 'object',
        required: ['requestId', 'apiKeyId'],
        properties: {
          requestId: { type: 'string' },
          apiKeyId: { type: 'string', format: 'uuid' },
        },
      },
      Pagination: {
        type: 'object',
        required: ['limit', 'offset', 'returned', 'hasMore'],
        description:
          'Offset pagination metadata. List responses are ordered newest first unless an endpoint documents a different order.',
        properties: {
          limit: { type: 'integer', minimum: 1, example: 100 },
          offset: { type: 'integer', minimum: 0, example: 0 },
          returned: {
            type: 'integer',
            minimum: 0,
            description: 'Number of items returned in this response page.',
            example: 25,
          },
          hasMore: {
            type: 'boolean',
            description:
              'True when another page may be available at offset + returned.',
            example: false,
          },
        },
      },
      WorkspaceRef: {
        type: 'object',
        required: ['id', 'slug', 'name'],
        description:
          'Workspace boundary for the returned record. Public v1 keeps /tenants/{slug} paths for compatibility; the slug identifies the workspace.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          name: { type: 'string' },
        },
      },
      ApiKeyCredential: {
        type: 'object',
        required: [
          'id',
          'keyPrefix',
          'scopes',
          'workspace',
          'createdAt',
          'expiresAt',
          'lastUsedAt',
          'usageCount',
          'lastUsedMethod',
          'lastUsedPath',
          'lastUsedStatusCode',
        ],
        description:
          'Display-safe metadata for the bearer API key used on the request. The secret token and hash are never returned.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          keyPrefix: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          workspace: { $ref: '#/components/schemas/WorkspaceRef' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
          lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
          usageCount: { type: 'integer', minimum: 0 },
          lastUsedMethod: { type: ['string', 'null'] },
          lastUsedPath: { type: ['string', 'null'] },
          lastUsedStatusCode: { type: ['integer', 'null'] },
        },
      },
      Project: {
        type: 'object',
        required: ['id', 'slug', 'name', 'workspace', 'visibility', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          name: { type: 'string' },
          workspace: { $ref: '#/components/schemas/WorkspaceRef' },
          description: { type: ['string', 'null'] },
          classification: { type: ['string', 'null'] },
          tags: {},
          visibility: { type: 'string', enum: ['public', 'private'] },
          createdAt: { type: 'string', format: 'date-time' },
          archivedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      CreateProjectRequest: {
        type: 'object',
        required: ['slug', 'name'],
        properties: {
          slug: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          templateSlug: {
            type: 'string',
            deprecated: true,
            description:
              'Deprecated compatibility field. New V5 project creation ignores template selection.',
          },
          classification: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          visibility: { type: 'string', enum: ['public', 'private'] },
        },
      },
      CreateHashAttestationRequest: {
        type: 'object',
        required: ['label', 'sha256'],
        properties: {
          label: { type: 'string' },
          description: { type: 'string' },
          sha256: {
            type: 'string',
            minLength: 64,
            maxLength: 64,
            description: 'Whole-file SHA-256 as 64 lowercase hex characters.',
          },
          fileName: { type: 'string' },
          byteSize: { type: 'integer', minimum: 0 },
          compliance: {
            type: 'object',
            description:
              'Optional compliance JSON artifact committed with the primary hash. The JSON body is not uploaded; send its SHA-256 and metadata only.',
            required: ['sha256'],
            properties: {
              sha256: {
                type: 'string',
                minLength: 64,
                maxLength: 64,
                description: 'SHA-256 of the canonical compliance JSON.',
              },
              fileName: { type: 'string' },
              byteSize: { type: 'integer', minimum: 0 },
              mediaType: {
                type: 'string',
                enum: ['application/json'],
                default: 'application/json',
              },
              canonicalization: {
                type: 'string',
                default: 'json-stable-v1',
              },
            },
          },
          sourceMetadata: {
            type: 'object',
            description:
              'Optional source metadata for model release provenance records. The model release JSON body is not uploaded; send its canonical hash and summary metadata only.',
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
              provider: { type: 'string', enum: ['model_release'] },
              recordType: { type: 'string', enum: ['model_provenance_record'] },
              schemaVersion: { type: 'string', example: '0.1' },
              canonicalHash: {
                type: 'string',
                minLength: 64,
                maxLength: 64,
                description: 'SHA-256 of the canonical model release record. Must match sha256.',
              },
              modelName: { type: 'string' },
              modelVersion: { type: 'string' },
              modelType: { type: 'string' },
              releaseStage: { type: 'string' },
              claimType: { type: 'string', example: 'model_release_approved' },
              claimText: { type: 'string' },
              claimScope: { type: 'string' },
              subjectType: { type: 'string' },
              subjectIdentifier: { type: 'string' },
              subjectHash: { type: 'string', minLength: 64, maxLength: 64 },
              artifactManifestHash: { type: 'string', minLength: 64, maxLength: 64 },
              modelCardHash: { type: 'string', minLength: 64, maxLength: 64 },
              datasetManifestHash: { type: 'string', minLength: 64, maxLength: 64 },
              evaluationReportHash: { type: 'string', minLength: 64, maxLength: 64 },
              riskReviewHash: { type: 'string', minLength: 64, maxLength: 64 },
              policyId: { type: 'string' },
              policyVersion: { type: 'string' },
              policyDecision: { type: 'string' },
              finalApprover: { type: 'string' },
              finalApprovalTimestamp: { type: 'string' },
              disclosureMode: { type: 'string' },
              verificationPolicy: { type: 'string' },
              retentionPeriod: { type: 'string' },
              knownLimitations: { type: 'string' },
            },
          },
        },
      },
      VerifyHashRequest: {
        type: 'object',
        properties: {
          submittedHash: {
            type: 'string',
            minLength: 64,
            maxLength: 64,
            description: 'Single SHA-256 hash to look up.',
          },
          candidateHashes: {
            type: 'array',
            minItems: 1,
            maxItems: 10000,
            items: { type: 'string', minLength: 64, maxLength: 64 },
            description: 'Content proof candidate hashes. The first committed match is returned.',
          },
          lookupKind: {
            type: 'string',
            enum: ['whole_file', 'content', 'exact_image', 'any'],
          },
        },
      },
      GrantVerifierAccessRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          message: { type: 'string' },
        },
      },
      VerifierAccessGrant: {
        type: 'object',
        required: [
          'id',
          'attestationId',
          'grantedToEmail',
          'status',
          'createdAt',
          'claimedAt',
          'revokedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          attestationId: { type: 'string', format: 'uuid' },
          grantedToEmail: { type: 'string', format: 'email' },
          status: { type: 'string', enum: ['pending', 'claimed', 'revoked'] },
          createdAt: { type: 'string', format: 'date-time' },
          claimedAt: { type: ['string', 'null'], format: 'date-time' },
          revokedAt: { type: ['string', 'null'], format: 'date-time' },
          claimToken: {
            type: 'string',
            description:
              'Returned only once for pending grants to unknown emails. Treat as a secret.',
          },
        },
      },
      Attestation: {
        type: 'object',
        required: [
          'id',
          'label',
          'state',
          'merkleRoot',
          'packageId',
          'receiptAvailable',
          'workspace',
          'createdAt',
          'confirmedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          label: { type: 'string' },
          description: { type: ['string', 'null'] },
          state: { type: 'string' },
          workspace: { $ref: '#/components/schemas/WorkspaceRef' },
          project: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              slug: { type: 'string' },
              name: { type: 'string' },
            },
          },
          merkleRoot: { type: ['string', 'null'] },
          packageId: { type: ['string', 'null'] },
          receiptAvailable: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          confirmedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      ReceiptMetadata: {
        type: 'object',
        required: [
          'attestationId',
          'attestationLabel',
          'state',
          'packageId',
          'merkleRoot',
          'receiptAvailable',
          'receiptPdfAvailable',
          'confirmedAt',
        ],
        properties: {
          attestationId: { type: 'string', format: 'uuid' },
          attestationLabel: { type: 'string' },
          state: { type: 'string' },
          packageId: { type: ['string', 'null'] },
          merkleRoot: { type: ['string', 'null'] },
          receiptAvailable: { type: 'boolean' },
          receiptPdfAvailable: { type: 'boolean' },
          confirmedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      Event: {
        type: 'object',
        required: ['id', 'category', 'action', 'payload', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          category: { type: 'string' },
          action: { type: 'string' },
          targetType: { type: ['string', 'null'] },
          targetId: { type: ['string', 'null'] },
          payload: {},
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateWebhookEndpointRequest: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri' },
          description: { type: 'string' },
          events: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['attestation.confirmed', 'attestation.failed', 'receipt.issued'],
            },
          },
        },
      },
      WebhookEndpoint: {
        type: 'object',
        required: ['id', 'url', 'events', 'createdAt', 'disabledAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string', format: 'uri' },
          description: { type: ['string', 'null'] },
          events: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          disabledAt: { type: ['string', 'null'], format: 'date-time' },
          signingSecret: {
            type: 'string',
            description: 'Returned only once when the endpoint is created.',
          },
        },
      },
      WebhookDelivery: {
        type: 'object',
        required: ['id', 'endpointId', 'eventType', 'status', 'attempts', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          endpointId: { type: 'string', format: 'uuid' },
          eventType: { type: 'string' },
          status: { type: 'string' },
          attempts: { type: 'integer' },
          responseStatus: { type: ['integer', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
          lastAttemptAt: { type: ['string', 'null'], format: 'date-time' },
          nextAttemptAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      EvidenceExportManifest: {
        type: 'object',
        required: [
          'export',
          'attestations',
          'attempts',
          'verificationResults',
          'verificationLinks',
          'events',
        ],
        properties: {
          export: {
            type: 'object',
            required: ['type', 'workspace', 'generatedAt', 'filters', 'counts'],
            properties: {
              type: {
                type: 'string',
                enum: ['evidence_manifest', 'evidence_export_job_manifest'],
              },
              workspace: { $ref: '#/components/schemas/WorkspaceRef' },
              generatedAt: { type: 'string', format: 'date-time' },
              filters: {
                type: 'object',
                properties: {
                  projectId: { type: ['string', 'null'], format: 'uuid' },
                  actorUserId: { type: ['string', 'null'], format: 'uuid' },
                  includeEvents: { type: 'boolean' },
                },
              },
              counts: {
                type: 'object',
                properties: {
                  attestations: { type: 'integer' },
                  attempts: { type: 'integer' },
                  verificationResults: { type: 'integer' },
                  verificationLinks: { type: 'integer' },
                  events: { type: 'integer' },
                },
              },
            },
          },
          attestations: { type: 'array', items: { type: 'object' } },
          attempts: { type: 'array', items: { type: 'object' } },
          verificationResults: { type: 'array', items: { type: 'object' } },
          verificationLinks: { type: 'array', items: { type: 'object' } },
          events: { type: 'array', items: { type: 'object' } },
        },
      },
      EvidenceExportJob: {
        type: 'object',
        required: [
          'id',
          'kind',
          'status',
          'artifactCount',
          'rowCount',
          'progressPercent',
          'retryCount',
          'maxRetries',
          'expiresAt',
          'retentionPolicy',
          'createdAt',
          'startedAt',
          'completedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          kind: { type: 'string' },
          status: { type: 'string' },
          filters: {},
          artifactCount: { type: 'integer' },
          rowCount: { type: 'integer' },
          resultObjectKey: { type: ['string', 'null'] },
          error: { type: ['string', 'null'] },
          progressPercent: { type: 'integer', minimum: 0, maximum: 100 },
          retryCount: { type: 'integer', minimum: 0 },
          maxRetries: { type: 'integer', minimum: 0 },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
          retentionPolicy: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: { type: ['string', 'null'], format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      EvidenceExportJobWithManifest: {
        type: 'object',
        required: ['job', 'manifest'],
        properties: {
          job: { $ref: '#/components/schemas/EvidenceExportJob' },
          manifest: { $ref: '#/components/schemas/EvidenceExportManifest' },
        },
      },
      EvidenceExportCleanupResult: {
        type: 'object',
        required: ['scanned', 'deleted', 'skipped', 'deletedObjectKeys'],
        properties: {
          scanned: { type: 'integer', minimum: 0 },
          deleted: { type: 'integer', minimum: 0 },
          skipped: { type: 'integer', minimum: 0 },
          deletedObjectKeys: { type: 'array', items: { type: 'string' } },
        },
      },
      EvidenceExportBundle: {
        type: 'object',
        required: [
          'schemaVersion',
          'type',
          'generatedAt',
          'manifest',
          'artifacts',
          'missingArtifacts',
          'counts',
        ],
        properties: {
          schemaVersion: { type: 'string', enum: ['1.0'] },
          type: { type: 'string', enum: ['proveria_evidence_bundle'] },
          generatedAt: { type: 'string', format: 'date-time' },
          manifest: { $ref: '#/components/schemas/EvidenceExportManifest' },
          artifacts: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'path',
                'objectKey',
                'contentType',
                'encoding',
                'byteSize',
                'bodyBase64',
              ],
              properties: {
                path: { type: 'string' },
                objectKey: { type: 'string' },
                contentType: { type: 'string' },
                encoding: { type: 'string', enum: ['base64'] },
                byteSize: { type: 'integer' },
                bodyBase64: { type: 'string', format: 'byte' },
              },
            },
          },
          missingArtifacts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['path', 'objectKey', 'reason'],
              properties: {
                path: { type: 'string' },
                objectKey: { type: 'string' },
                reason: { type: 'string', enum: ['not_found'] },
              },
            },
          },
          counts: {
            type: 'object',
            required: ['artifacts', 'missingArtifacts'],
            properties: {
              artifacts: { type: 'integer' },
              missingArtifacts: { type: 'integer' },
            },
          },
        },
      },
    },
    examples: {
      ApiKeyCredential: {
        summary: 'Current API key metadata',
        value: { data: sampleApiKeyCredential, meta: sampleMeta },
      },
      ProjectList: {
        summary: 'Project list',
        value: { data: [sampleProject], meta: sampleMeta },
      },
      ProjectCreated: {
        summary: 'Project created',
        value: { data: sampleProject, meta: sampleMeta },
      },
      AttestationAccepted: {
        summary: 'Hash attestation accepted for validation',
        value: {
          data: { ...sampleAttestation, state: 'validating', confirmedAt: null },
          meta: sampleMeta,
        },
      },
      AttestationList: {
        summary: 'Filtered attestation list',
        value: { data: [sampleAttestation], meta: { ...sampleMeta, limit: 25, offset: 0 } },
      },
      AttestationDetail: {
        summary: 'Attestation detail',
        value: { data: sampleAttestation, meta: sampleMeta },
      },
      ReceiptMetadata: {
        summary: 'Receipt metadata',
        value: {
          data: {
            attestationId: sampleAttestation.id,
            attestationLabel: sampleAttestation.label,
            state: sampleAttestation.state,
            packageId: sampleAttestation.packageId,
            merkleRoot: sampleAttestation.merkleRoot,
            receiptAvailable: true,
            receiptPdfAvailable: true,
            confirmedAt: sampleAttestation.confirmedAt,
          },
          meta: sampleMeta,
        },
      },
      VerifierAccessGrant: {
        summary: 'Verifier access grant',
        value: {
          data: {
            id: '018f8f2a-3333-7333-9333-333333333333',
            attestationId: sampleAttestation.id,
            grantedToEmail: 'verifier@example.com',
            status: 'claimed',
            createdAt: '2026-06-05T12:02:00.000Z',
            claimedAt: '2026-06-05T12:02:00.000Z',
            revokedAt: null,
          },
          meta: sampleMeta,
        },
      },
      VerificationResult: {
        summary: 'Verification result package',
        value: {
          data: {
            packageId: 'pkg_2ae48582609f29c65a7ea4efba5f8c50',
            linkId: 'vrf_8e64e87e2a8677d212679351',
            signed: true,
            retrieveUrl: '/lookup-results/pkg_2ae48582609f29c65a7ea4efba5f8c50',
            verificationUrl: '/v/vrf_8e64e87e2a8677d212679351',
            package: {
              result_type: 'match',
              submitted_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            },
          },
          meta: sampleMeta,
        },
      },
      EventList: {
        summary: 'Filtered event list',
        value: {
          data: [
            {
              id: '018f8f2a-4444-7444-9444-444444444444',
              category: 'attestation_lifecycle',
              action: 'attestation.confirmed',
              targetType: 'attestation',
              targetId: sampleAttestation.id,
              payload: { apiKeyId: sampleMeta.apiKeyId },
              createdAt: '2026-06-05T12:01:30.000Z',
            },
          ],
          meta: { ...sampleMeta, limit: 25, offset: 0 },
        },
      },
      EvidenceExportManifest: {
        summary: 'Evidence export manifest',
        value: {
          data: {
            export: {
              type: 'evidence_manifest',
              workspace: sampleProject.workspace,
              generatedAt: '2026-06-05T12:03:00.000Z',
              filters: { projectId: sampleProject.id, actorUserId: null, includeEvents: true },
              counts: {
                attestations: 1,
                attempts: 1,
                verificationResults: 1,
                verificationLinks: 1,
                events: 1,
              },
            },
            attestations: [{ id: sampleAttestation.id, label: sampleAttestation.label }],
            attempts: [],
            verificationResults: [],
            verificationLinks: [],
            events: [],
          },
          meta: sampleMeta,
        },
      },
      EvidenceExportJobCreated: {
        summary: 'Evidence export job created',
        value: {
          data: {
            job: {
              id: '018f8f2a-7777-7777-9777-777777777777',
              kind: 'evidence_export',
              status: 'queued',
              filters: { projectId: sampleProject.id, includeEvents: true, limit: 100 },
              artifactCount: 5,
              rowCount: 5,
              resultObjectKey: null,
              error: null,
              progressPercent: 0,
              retryCount: 0,
              maxRetries: 3,
              expiresAt: '2026-07-05T12:03:01.000Z',
              retentionPolicy: {
                retention_days: 30,
                delete_after_expiration: true,
              },
              createdAt: '2026-06-05T12:03:00.000Z',
              startedAt: null,
              completedAt: null,
            },
            manifest: {
              export: {
                type: 'evidence_export_job_manifest',
                workspace: sampleProject.workspace,
                generatedAt: '2026-06-05T12:03:00.000Z',
                filters: { projectId: sampleProject.id, actorUserId: null, includeEvents: true },
                counts: {
                  attestations: 1,
                  attempts: 1,
                  verificationResults: 1,
                  verificationLinks: 1,
                  events: 1,
                },
              },
              attestations: [{ id: sampleAttestation.id, label: sampleAttestation.label }],
              attempts: [],
              verificationResults: [],
              verificationLinks: [],
              events: [],
            },
          },
          meta: sampleMeta,
        },
      },
      WebhookEndpoint: {
        summary: 'Webhook endpoint',
        value: {
          data: {
            id: '018f8f2a-5555-7555-9555-555555555555',
            url: 'https://example.com/proveria/webhooks',
            description: 'Production receiver',
            events: ['receipt.issued'],
            createdAt: '2026-06-05T12:04:00.000Z',
            disabledAt: null,
            signingSecret: 'whsec_example_returned_once',
          },
          meta: sampleMeta,
        },
      },
      WebhookDelivery: {
        summary: 'Webhook delivery',
        value: {
          data: {
            id: '018f8f2a-6666-7666-9666-666666666666',
            endpointId: '018f8f2a-5555-7555-9555-555555555555',
            eventType: 'webhook.test',
            status: 'pending',
            attempts: 0,
            responseStatus: null,
            createdAt: '2026-06-05T12:04:30.000Z',
            lastAttemptAt: null,
            nextAttemptAt: '2026-06-05T12:04:30.000Z',
          },
          meta: sampleMeta,
        },
      },
      ErrorEnvelope: {
        summary: 'Stable public API error envelope',
        value: {
          error: {
            code: 'invalid_sha256',
            message: 'sha256 must be 64 lowercase hex characters.',
            retryable: false,
            requestId: sampleMeta.requestId,
            fieldErrors: [
              {
                field: 'sha256',
                message: 'sha256 must be 64 lowercase hex characters.',
                code: 'pattern',
              },
            ],
          },
        },
      },
    },
  },
  security: [{ bearerApiKey: [] }],
  paths: {
    '/v1/docs': {
      get: {
        summary: 'Open the public API documentation page',
        security: [],
        responses: {
          '200': {
            description: 'HTML API reference page generated from /v1/openapi.json',
            content: {
              'text/html': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    },
    '/v1/docs/config.json': {
      get: {
        summary: 'Fetch public API documentation configuration',
        security: [],
        responses: {
          '200': {
            description: 'Docs configuration for external renderers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'openapiUrl', 'docsUrl', 'version'],
                  properties: {
                    title: { type: 'string', example: 'Proveria Public API' },
                    openapiUrl: { type: 'string', example: '/v1/openapi.json' },
                    docsUrl: { type: 'string', example: '/v1/docs' },
                    version: { type: 'string', example: 'v1' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/openapi.json': {
      get: {
        summary: 'Fetch the public API OpenAPI document',
        security: [],
        responses: {
          '200': { description: 'OpenAPI document' },
        },
      },
    },
    '/v1/tenants/{slug}/api-key': {
      get: {
        summary: 'Inspect the current API key',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Display-safe metadata for the authenticated API key',
            headers: rateLimitResponseHeaders,
            content: {
              ...jsonEnvelope('#/components/schemas/ApiKeyCredential'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/ApiKeyCredential')['application/json'],
                examples: {
                  apiKeyCredential: { $ref: '#/components/examples/ApiKeyCredential' },
                },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/projects': {
      get: {
        summary: 'List active projects for a tenant',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          limitParameter(),
          offsetParameter,
        ],
        responses: {
          '200': {
            description: 'Project list',
            headers: rateLimitResponseHeaders,
            content: {
              ...jsonPaginatedArrayEnvelope('#/components/schemas/Project'),
              'application/json': {
                ...jsonPaginatedArrayEnvelope('#/components/schemas/Project')['application/json'],
                examples: { projectList: { $ref: '#/components/examples/ProjectList' } },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
      post: {
        summary: 'Create a project',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateProjectRequest' },
              example: {
                slug: 'evaluation-evidence',
                name: 'Evaluation Evidence',
                visibility: 'private',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Project created',
            headers: rateLimitResponseHeaders,
            content: {
              ...jsonEnvelope('#/components/schemas/Project'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/Project')['application/json'],
                examples: { projectCreated: { $ref: '#/components/examples/ProjectCreated' } },
              },
            },
          },
          '400': { $ref: '#/components/schemas/ErrorEnvelope' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          '409': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/projects/{projectSlug}/attestations': {
      post: {
        summary: 'Create a whole-file SHA-256 attestation',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'projectSlug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateHashAttestationRequest' },
              example: {
                label: 'Graduation Model 2026.06 release',
                sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                fileName: 'model-release.json',
                byteSize: 4096,
                sourceMetadata: {
                  provider: 'model_release',
                  recordType: 'model_provenance_record',
                  schemaVersion: '0.1',
                  canonicalHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  modelName: 'Graduation Model',
                  modelVersion: '2026.06',
                  modelType: 'classifier',
                  releaseStage: 'production',
                  claimType: 'model_release_approved',
                  claimText: 'This model version was approved for production release.',
                  claimScope: 'full_release_package',
                  subjectType: 'model_artifact',
                  subjectIdentifier: 'registry://models/graduation/2026.06',
                  subjectHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  artifactManifestHash:
                    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                  modelCardHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                  datasetManifestHash:
                    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                  evaluationReportHash:
                    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                  policyId: 'AI-GOV-001',
                  policyVersion: '2026.1',
                  policyDecision: 'approved',
                  finalApprover: 'Model Risk Committee',
                  finalApprovalTimestamp: '2026-06-04T18:00:00Z',
                  disclosureMode: 'public_receipt_private_evidence',
                  verificationPolicy: 'verify_model_release_claim',
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Attestation accepted for validation',
            content: {
              ...jsonEnvelope('#/components/schemas/Attestation'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/Attestation')['application/json'],
                examples: {
                  attestationAccepted: { $ref: '#/components/examples/AttestationAccepted' },
                },
              },
            },
          },
          '400': { $ref: '#/components/schemas/ErrorEnvelope' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          '409': { $ref: '#/components/schemas/ErrorEnvelope' },
          '413': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations': {
      get: {
        summary: 'List attestations for a tenant',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'project', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          limitParameter(),
          offsetParameter,
        ],
        responses: {
          '200': {
            description: 'Attestation list',
            content: {
              ...jsonPaginatedArrayEnvelope('#/components/schemas/Attestation'),
              'application/json': {
                ...jsonPaginatedArrayEnvelope('#/components/schemas/Attestation')['application/json'],
                examples: { attestationList: { $ref: '#/components/examples/AttestationList' } },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}': {
      get: {
        summary: 'Fetch attestation detail',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Attestation detail',
            content: {
              ...jsonEnvelope('#/components/schemas/Attestation'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/Attestation')['application/json'],
                examples: { attestation: { $ref: '#/components/examples/AttestationDetail' } },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}/receipt': {
      get: {
        summary: 'Fetch attestation receipt metadata',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Receipt metadata',
            content: {
              ...jsonEnvelope('#/components/schemas/ReceiptMetadata'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/ReceiptMetadata')['application/json'],
                examples: { receiptMetadata: { $ref: '#/components/examples/ReceiptMetadata' } },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}/receipt.json': {
      get: {
        summary: 'Download attestation receipt JSON',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Signed receipt JSON artifact',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}/receipt.pdf': {
      get: {
        summary: 'Download attestation receipt PDF',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Receipt PDF artifact',
            content: {
              'application/pdf': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}/lookup': {
      post: {
        summary: 'Verify a hash against an attestation',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/VerifyHashRequest' },
              example: {
                submittedHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                lookupKind: 'whole_file',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Verification result package',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data', 'meta'],
                  properties: {
                    data: { type: 'object', additionalProperties: true },
                    meta: { $ref: '#/components/schemas/Meta' },
                  },
                },
                examples: {
                  verificationResult: { $ref: '#/components/examples/VerificationResult' },
                },
              },
            },
          },
          '400': { $ref: '#/components/schemas/ErrorEnvelope' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}/verifier-access': {
      post: {
        summary: 'Grant verifier access to an attestation',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GrantVerifierAccessRequest' },
              example: {
                email: 'verifier@example.com',
                message: 'Please verify this proof package.',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Verifier access granted',
            content: {
              ...jsonEnvelope('#/components/schemas/VerifierAccessGrant'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/VerifierAccessGrant')['application/json'],
                examples: {
                  verifierAccessGrant: { $ref: '#/components/examples/VerifierAccessGrant' },
                },
              },
            },
          },
          '200': {
            description: 'Existing active grant returned',
            content: {
              ...jsonEnvelope('#/components/schemas/VerifierAccessGrant'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/VerifierAccessGrant')['application/json'],
                examples: {
                  verifierAccessGrant: { $ref: '#/components/examples/VerifierAccessGrant' },
                },
              },
            },
          },
          '400': { $ref: '#/components/schemas/ErrorEnvelope' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          '409': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/attestations/{id}/verifier-access/{grantId}': {
      delete: {
        summary: 'Revoke verifier access to an attestation',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          {
            name: 'grantId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Verifier access revoked' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          '409': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/events': {
      get: {
        summary: 'List recent tenant events',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'targetType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'targetId', in: 'query', required: false, schema: { type: 'string' } },
          limitParameter(),
          offsetParameter,
        ],
        responses: {
          '200': {
            description: 'Event list',
            content: {
              ...jsonPaginatedArrayEnvelope('#/components/schemas/Event'),
              'application/json': {
                ...jsonPaginatedArrayEnvelope('#/components/schemas/Event')['application/json'],
                examples: { eventList: { $ref: '#/components/examples/EventList' } },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/evidence-export/manifest': {
      get: {
        summary: 'Build an evidence export manifest',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'projectId',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'actorUserId',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'uuid' },
          },
          { name: 'includeEvents', in: 'query', required: false, schema: { type: 'boolean' } },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 1000 },
          },
        ],
        responses: {
          '200': {
            description: 'Evidence export manifest',
            content: {
              ...jsonEnvelope('#/components/schemas/EvidenceExportManifest'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/EvidenceExportManifest')['application/json'],
                examples: {
                  evidenceExportJobCreated: {
                    $ref: '#/components/examples/EvidenceExportJobCreated',
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/evidence-export/jobs': {
      get: {
        summary: 'List evidence export jobs',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            ...limitParameter(100, 25),
          },
          offsetParameter,
        ],
        responses: {
          '200': {
            description: 'Evidence export jobs',
            content: jsonPaginatedArrayEnvelope('#/components/schemas/EvidenceExportJob'),
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
      post: {
        summary: 'Create a queued evidence export job manifest',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string', format: 'uuid' },
                  actorUserId: { type: 'string', format: 'uuid' },
                  includeEvents: { type: 'boolean' },
                  limit: { type: 'integer', minimum: 1, maximum: 1000 },
                },
              },
              example: {
                projectId: sampleProject.id,
                includeEvents: true,
                limit: 100,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Evidence export job created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data', 'meta'],
                  properties: {
                    data: { $ref: '#/components/schemas/EvidenceExportJobWithManifest' },
                    meta: { $ref: '#/components/schemas/Meta' },
                  },
                },
                examples: {
                  evidenceExportManifest: {
                    $ref: '#/components/examples/EvidenceExportManifest',
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          '409': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/evidence-export/jobs/cleanup-expired': {
      post: {
        summary: 'Clean up expired evidence export bundles',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Expired evidence export bundle cleanup result',
            content: jsonEnvelope('#/components/schemas/EvidenceExportCleanupResult'),
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/evidence-export/jobs/{jobId}': {
      get: {
        summary: 'Get an evidence export job manifest',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Evidence export job and manifest',
            content: jsonEnvelope('#/components/schemas/EvidenceExportJobWithManifest'),
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/evidence-export/jobs/{jobId}/bundle': {
      get: {
        summary: 'Download an evidence export artifact bundle',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Evidence export artifact bundle',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EvidenceExportBundle' },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/webhook-endpoints': {
      get: {
        summary: 'List webhook endpoints',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          limitParameter(),
          offsetParameter,
        ],
        responses: {
          '200': {
            description: 'Webhook endpoint list',
            content: jsonPaginatedArrayEnvelope('#/components/schemas/WebhookEndpoint'),
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
      post: {
        summary: 'Create a webhook endpoint',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateWebhookEndpointRequest' },
              example: {
                url: 'https://example.com/proveria/webhooks',
                description: 'Production receiver',
                events: ['receipt.issued'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Webhook endpoint created',
            content: {
              ...jsonEnvelope('#/components/schemas/WebhookEndpoint'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/WebhookEndpoint')['application/json'],
                examples: { webhookEndpoint: { $ref: '#/components/examples/WebhookEndpoint' } },
              },
            },
          },
          '400': { $ref: '#/components/schemas/ErrorEnvelope' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/webhook-endpoints/{endpointId}': {
      delete: {
        summary: 'Disable a webhook endpoint',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'endpointId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Webhook endpoint disabled' },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          '409': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/webhook-endpoints/{endpointId}/test': {
      post: {
        summary: 'Send a test event to a webhook endpoint',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'endpointId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        responses: {
          '202': {
            description: 'Test webhook delivery enqueued',
            content: {
              ...jsonEnvelope('#/components/schemas/WebhookDelivery'),
              'application/json': {
                ...jsonEnvelope('#/components/schemas/WebhookDelivery')['application/json'],
                examples: { webhookDelivery: { $ref: '#/components/examples/WebhookDelivery' } },
              },
            },
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
    '/v1/tenants/{slug}/webhook-deliveries': {
      get: {
        summary: 'List recent webhook deliveries',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          limitParameter(),
          offsetParameter,
        ],
        responses: {
          '200': {
            description: 'Webhook delivery list',
            content: jsonPaginatedArrayEnvelope('#/components/schemas/WebhookDelivery'),
          },
          '401': { $ref: '#/components/schemas/ErrorEnvelope' },
          '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          '404': { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    },
  },
} as const;
