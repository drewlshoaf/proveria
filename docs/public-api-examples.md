# Public API Examples

These examples use the workspace-scoped public API. In the V5 product model,
the `{slug}` segment is the workspace slug.

For authentication, idempotency, retry, error-envelope, pagination, and
credential-telemetry rules, see
`docs/public-api-integration-policy.md`.

For a step-by-step API-only producer flow, see
`docs/v6-api-producer-quickstart.md`.

Authenticated responses include `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset` headers. These publish the public API rate-limit policy before
strict request blocking is enabled.

Set local variables:

```bash
export PROVERIA_API_URL=http://127.0.0.1:3001
export PROVERIA_WORKSPACE=evaluation-workspace
export PROVERIA_API_KEY=prv_v1_replace_me
```

Every mutation requires an `Idempotency-Key` header. Use a stable value when
retrying the same upstream job.

## Inspect Current API Key

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/api-key" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"
```

## OpenAPI

```bash
curl "$PROVERIA_API_URL/v1/openapi.json"
```

TypeScript SDK:

```ts
import { ProveriaClient } from '@proveria/sdk';

const proveria = new ProveriaClient({
  apiUrl: process.env.PROVERIA_API_URL,
});

const openapi = await proveria.docs.getOpenApi();
const docsConfig = await proveria.docs.getConfig();

console.log(openapi.info.title, docsConfig.docsUrl);
```

## Create A Project

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/projects" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: project-evaluation-evidence-001" \
  -d '{
    "slug": "evaluation-evidence",
    "name": "Evaluation Evidence",
    "visibility": "private"
  }'
```

## Create A Hash Attestation

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/projects/evaluation-evidence/attestations" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: attestation-invoice-2026-05-001" \
  -d '{
    "label": "invoice-2026-05",
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "fileName": "invoice.pdf",
    "byteSize": 1234
  }'
```

To attach a compliance JSON document, hash a canonical JSON representation
locally and send the hash plus metadata. Do not send the JSON body itself.

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/projects/evaluation-evidence/attestations" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: attestation-invoice-2026-05-compliance-001" \
  -d '{
    "label": "invoice-2026-05",
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "fileName": "invoice.pdf",
    "byteSize": 1234,
    "compliance": {
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "fileName": "controls.json",
      "byteSize": 42,
      "mediaType": "application/json",
      "canonicalization": "json-stable-v1"
    }
  }'
```

The response starts in `validating`. Poll the attestation until `state` becomes
`confirmed`.

## Create A Model Release Attestation

For model release provenance, canonicalize the model release record locally,
hash the canonical JSON, and send the hash plus source metadata. Do not send
the model release record body itself.

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/projects/evaluation-evidence/attestations" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: attestation-model-release-2026-06-001" \
  -d '{
    "label": "Graduation Model 2026.06 release",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "fileName": "model-release.json",
    "byteSize": 4096,
    "sourceMetadata": {
      "provider": "model_release",
      "recordType": "model_provenance_record",
      "schemaVersion": "0.1",
      "canonicalHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "modelName": "Graduation Model",
      "modelVersion": "2026.06",
      "modelType": "classifier",
      "releaseStage": "production",
      "claimType": "model_release_approved",
      "claimText": "This model version was approved for production release.",
      "claimScope": "full_release_package",
      "subjectType": "model_artifact",
      "subjectIdentifier": "registry://models/graduation/2026.06",
      "subjectHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "artifactManifestHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "modelCardHash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "datasetManifestHash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "evaluationReportHash": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "riskReviewHash": "1111111111111111111111111111111111111111111111111111111111111111",
      "policyId": "AI-GOV-001",
      "policyVersion": "2026.1",
      "policyDecision": "approved",
      "finalApprover": "Model Risk Committee",
      "finalApprovalTimestamp": "2026-06-04T18:00:00Z",
      "disclosureMode": "public_receipt_private_evidence",
      "verificationPolicy": "verify_model_release_claim",
      "retentionPeriod": "7 years"
    }
  }'
```

The `sourceMetadata.canonicalHash` value must match `sha256`. The recommended
way to create this payload is:

```bash
proveria model-release init --output ./model-release.json
proveria model-release attest ./model-release.json --project evaluation-evidence
```

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/<attestation-id>" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"
```

## List Attestations

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations?project=evaluation-evidence&status=confirmed&limit=25" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"
```

## Download Receipt Artifacts

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/<attestation-id>/receipt" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/<attestation-id>/receipt.json" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -o receipt.json

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/<attestation-id>/receipt.pdf" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -o receipt.pdf
```

## Verify A Hash

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/<attestation-id>/lookup" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "submittedHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "lookupKind": "whole_file"
  }'
```

## Grant Verifier Access

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/<attestation-id>/verifier-access" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: grant-verifier-example-001" \
  -d '{
    "email": "verifier@example.com",
    "message": "Please verify this proof package."
  }'
```

## Export Evidence

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/evidence-export/manifest?includeEvents=true&limit=100" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"
```

Create a durable export job and retrieve it later:

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/evidence-export/jobs" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evidence-export-example-001" \
  -d '{
    "includeEvents": true,
    "limit": 100
  }'

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/evidence-export/jobs/<job-id>" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"
```

## Webhook Test

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/webhook-endpoints" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: webhook-endpoint-example-001" \
  -d '{
    "url": "https://example.com/proveria/webhooks",
    "description": "Production receiver",
    "events": ["receipt.issued"]
  }'

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/webhook-endpoints/<endpoint-id>/test" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Idempotency-Key: webhook-test-example-001" \
  -X POST
```

## Error Shape

Public API errors always use this envelope:

```json
{
  "error": {
    "code": "not_found",
    "message": "The requested resource was not found.",
    "retryable": false,
    "requestId": "req_018f8f2a_example"
  }
}
```
