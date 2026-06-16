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
