from proveria import verify_webhook_signature_detailed

verification = verify_webhook_signature_detailed(
    signing_secret="whsec_...",
    signature_header="t=2026-05-25T18:00:00.000Z,v1=<hex-signature>",
    body=b'{"type":"receipt.issued"}',
)

if verification.valid:
    print("valid")
else:
    print(f"invalid: {verification.reason}")
