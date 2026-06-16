from proveria import ProveriaApiError, ProveriaClient, RetryOptions, sha256_hex

client = ProveriaClient(
    api_key="prv_v1_...",
    tenant="evaluation-workspace",
    api_url="http://127.0.0.1:3001",
    retry=RetryOptions(max_attempts=3),
)

payload = b"replace with file bytes"

try:
    client.projects.create(
        slug="evaluation-evidence",
        name="Evaluation Evidence",
        visibility="private",
        idempotency_key="project-evaluation-evidence-001",
    )
    created = client.attestations.create_hash(
        project="evaluation-evidence",
        label="python-example",
        sha256=sha256_hex(payload),
        file_name="example.txt",
        byte_size=len(payload),
        idempotency_key="python-example-attestation-001",
    )
    receipt = client.receipts.get(created["data"]["id"])
    verification = client.attestations.verify_hash(
        attestation_id=created["data"]["id"],
        sha256=sha256_hex(payload),
        lookup_kind="whole_file",
    )
    print(created["data"]["id"], receipt["data"]["receiptAvailable"], verification["data"])
except ProveriaApiError as error:
    print(error.code, error.request_id, error.retryable, error.field_errors)
