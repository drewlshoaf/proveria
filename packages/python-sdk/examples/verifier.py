from proveria import ProveriaClient, sha256_hex

client = ProveriaClient(
    api_key="prv_v1_...",
    tenant="evaluation-workspace",
    api_url="http://127.0.0.1:3001",
)

result = client.attestations.verify_hash(
    attestation_id="attestation-id",
    sha256=sha256_hex(b"replace with file bytes"),
    lookup_kind="whole_file",
)

print(result)
