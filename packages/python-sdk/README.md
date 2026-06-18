# proveria Python SDK

Developer-preview Python SDK for the Proveria public API. Runtime code uses
only the Python standard library. Packaging metadata is included for local
installs, wheel builds, and future publication.

For public API authentication, idempotency, retry, error-envelope, pagination,
and credential-telemetry rules, see
`docs/public-api-integration-policy.md`.

## Install Locally

From the monorepo root:

```bash
python3 -m pip install -e ./packages/python-sdk
```

Or build a local wheel:

```bash
python3 -m pip wheel ./packages/python-sdk --no-deps --wheel-dir /tmp/proveria-python-dist
```

Run the package tests without installing:

```bash
PYTHONPATH=packages/python-sdk python3 -m unittest discover packages/python-sdk/tests
```

```python
from proveria import ProveriaClient, RetryOptions

client = ProveriaClient(
    api_key="prv_v1_...",
    tenant="evaluation-workspace",
    api_url="http://127.0.0.1:3001",
    retry=RetryOptions(max_attempts=3),
)
```

## API Docs And OpenAPI

Docs endpoints are public and do not require an API key:

```python
docs = ProveriaClient(api_url="http://127.0.0.1:3001")

openapi = docs.docs.get_openapi()
docs_config = docs.docs.get_config()

print(openapi["info"]["title"], docs_config["docsUrl"])
```

## Credential Introspection

```python
credential = client.api_keys.current()

print(
    credential["data"]["keyPrefix"],
    credential["data"]["scopes"],
    credential["data"]["usageCount"],
    credential["data"]["lastUsedAt"],
)
```

## Producer Flow

```python
from proveria import ProveriaApiError, ProveriaClient, sha256_hex

client = ProveriaClient(
    api_key="prv_v1_...",
    tenant="evaluation-workspace",
    api_url="http://127.0.0.1:3001",
    retry={"max_attempts": 3},
)

payload = b"example file bytes"
sha256 = sha256_hex(payload)

try:
    client.projects.create(
        slug="evaluation-evidence",
        name="Evaluation Evidence",
        visibility="private",
        idempotency_key="project-evaluation-evidence-001",
    )

    attestations = client.attestations.list(
        project="evaluation-evidence",
        status="confirmed",
        limit=25,
    )
    print(attestations["meta"]["pagination"]["hasMore"])
    print(attestations["meta"].get("rateLimit", {}).get("remaining"))

    created = client.attestations.create_hash(
        project="evaluation-evidence",
        label="python-example",
        sha256=sha256,
        file_name="example.txt",
        byte_size=len(payload),
        idempotency_key="upstream-job-123",
    )

    receipt = client.receipts.get(created["data"]["id"])
    receipt_json = client.receipts.get_json(created["data"]["id"])
    receipt_pdf = client.receipts.get_pdf(created["data"]["id"])

    print(receipt["data"]["receiptAvailable"], receipt_json, len(receipt_pdf))
except ProveriaApiError as error:
    print(error.code, error.request_id, error.retryable, error.field_errors)
```

Compatibility aliases such as `client.create_hash_attestation(...)`,
`client.get_attestation(...)`, and `client.verify_hash(...)` remain available
for the original spike API.

## Dataset Inventory Receipts

Use `create_dataset_inventory` when you have a canonical dataset inventory
record dict. The SDK canonicalizes the JSON, hashes it locally, extracts
dataset summary metadata, and sends only hash metadata to the public API.

```python
dataset_inventory_record = {
    "record_type": "dataset_inventory_record",
    "schema_version": "0.1",
    "dataset": {
        "name": "Training Dataset",
        "version": "2026.06",
        "inventory_scope": "folder",
        "source_owner": "Data Governance",
        "license_usage_basis": "Internal governed dataset approval.",
        "data_classification": "confidential",
        "retention_rule": "7 years",
    },
    "summary": {
        "file_count": 2,
        "total_bytes": 1536,
        "dataset_root_hash": "b" * 64,
        "hash_algorithm": "sha256",
    },
    "files": [
        {"path": "train/a.jsonl", "sha256": "c" * 64, "byte_size": 1024},
        {"path": "eval/b.jsonl", "sha256": "d" * 64, "byte_size": 512},
    ],
}

dataset_inventory = client.attestations.create_dataset_inventory(
    project="evaluation-evidence",
    record=dataset_inventory_record,
    label="Training Dataset 2026.06 inventory",
    idempotency_key="dataset-inventory-2026-06",
)

print(dataset_inventory["data"]["id"])
```

Use `create_dataset_revision` when you have a canonical revision record produced
from two inventory records.

```python
dataset_revision_record = {
    "record_type": "dataset_revision_record",
    "schema_version": "0.1",
    "dataset": {
        "name": "Training Dataset",
        "previous_version": "2026.05",
        "next_version": "2026.06",
    },
    "summary": {
        "new_file_count": 1,
        "changed_file_count": 0,
        "removed_file_count": 0,
        "unchanged_file_count": 12,
        "previous_dataset_root_hash": "a" * 64,
        "next_dataset_root_hash": "b" * 64,
        "revision_root_hash": "c" * 64,
        "hash_algorithm": "sha256",
    },
    "changes": {
        "new": [{"path": "train/new.jsonl", "sha256": "d" * 64, "byte_size": 1024}],
        "changed": [],
        "removed": [],
        "unchanged": [],
    },
}

dataset_revision = client.attestations.create_dataset_revision(
    project="evaluation-evidence",
    record=dataset_revision_record,
    idempotency_key="dataset-revision-2026-05-2026-06",
)

print(dataset_revision["data"]["id"])
```

## Model Release Receipts

Use `create_model_release` when you have a claim-backed model provenance record
dict. The SDK canonicalizes the JSON, hashes it locally, extracts the model
release metadata, and sends only hash metadata to the public API.

```python
model_release_record = {
    "record_type": "model_provenance_record",
    "schema_version": "0.1",
    "model": {
        "name": "Graduation Model",
        "version": "2026.06",
        "type": "classifier",
        "release_stage": "production",
    },
    "claim": {
        "claim_type": "model_release_approved",
        "claim_text": "This model version was approved for production release.",
        "claim_scope": "full_release_package",
        "subject_type": "model_artifact",
        "subject_identifier": "registry://models/graduation/2026.06",
        "subject_hash": "b" * 64,
    },
    "artifacts": {
        "artifact_manifest_hash": "c" * 64,
        "model_card_hash": "d" * 64,
    },
    "data_provenance": {"dataset_manifest_hash": "e" * 64},
    "evaluation": {"evaluation_report_hash": "f" * 64},
    "policy": {
        "policy_id": "AI-GOV-001",
        "policy_version": "2026.1",
        "policy_decision": "approved",
    },
    "approval": {
        "final_approver": "Model Risk Committee",
        "final_approval_timestamp": "2026-06-04T18:00:00Z",
    },
    "disclosure": {
        "disclosure_mode": "public_receipt_private_evidence",
        "verification_policy": "verify_model_release_claim",
    },
}

model_release = client.attestations.create_model_release(
    project="evaluation-evidence",
    record=model_release_record,
    label="Graduation Model 2026.06 release",
    idempotency_key="model-release-2026-06",
)

print(model_release["data"]["id"])
```

## Verifier Access

```python
grant = client.attestations.grant_verifier_access(
    attestation_id=created["data"]["id"],
    email="verifier@example.com",
    message="Please verify this proof package.",
)

client.attestations.revoke_verifier_access(
    attestation_id=created["data"]["id"],
    grant_id=grant["data"]["id"],
)
```

## Evidence Exports

```python
manifest = client.evidence_exports.manifest(include_events=True)
print(manifest["data"]["export"]["workspace"]["name"])

export_job = client.evidence_exports.create_job(include_events=True)
print(export_job["data"]["job"]["id"])

completed = client.evidence_exports.get_job(export_job["data"]["job"]["id"])
bundle = client.evidence_exports.get_bundle(export_job["data"]["job"]["id"])

print(completed["data"]["manifest"]["export"]["counts"])
print(bundle["type"], bundle["counts"])
```

## Webhooks

```python
endpoint = client.webhooks.create_endpoint(
    url="https://example.com/proveria/webhooks",
    events=["receipt.issued"],
    description="Production receiver",
)

print(endpoint["data"]["signingSecret"])
```

Receivers can verify signed deliveries with:

```python
from proveria import verify_webhook_signature_detailed

verification = verify_webhook_signature_detailed(
    signing_secret="whsec_...",
    signature_header=request_headers["proveria-webhook-signature"],
    body=raw_body,
)

if not verification.valid:
    raise ValueError(f"invalid webhook signature: {verification.reason}")
```

## Current Coverage

The Python SDK now tracks the TypeScript SDK's core public API surface:

- API-key authentication and current-key metadata
- public docs helpers for `/v1/openapi.json` and `/v1/docs/config.json`
- project list/create
- hash attestation create/list/detail/lookup
- receipt metadata, JSON, and PDF artifact fetch
- verifier access grant/revoke
- events list with filters
- evidence export manifest, jobs, and bundles
- webhook endpoint, delivery, and test helpers
- response metadata with parsed rate-limit headers
- opt-in retry behavior for network failures and retryable API errors
- webhook signature verification with structured failure reasons

Future package work should add the publishing workflow, optional type checking
in CI, and richer typed response models once the public API stabilizes.
