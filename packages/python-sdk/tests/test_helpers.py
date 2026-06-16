from __future__ import annotations

import hmac
import unittest
from datetime import datetime, timezone
from hashlib import sha256

from proveria import sha256_hex, verify_webhook_signature, verify_webhook_signature_detailed


class HelperTests(unittest.TestCase):
    def test_sha256_hex(self) -> None:
        self.assertEqual(
            sha256_hex("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        )

    def test_webhook_signature(self) -> None:
        body = '{"ok": true}'
        timestamp = "2026-05-25T18:00:00.000Z"
        signature = hmac.new(
            b"whsec_test",
            f"{timestamp}.{body}".encode("utf-8"),
            sha256,
        ).hexdigest()

        self.assertTrue(
            verify_webhook_signature(
                signing_secret="whsec_test",
                signature_header=f"t={timestamp},v1={signature}",
                body=body,
                now=datetime(2026, 5, 25, 18, 1, tzinfo=timezone.utc),
            )
        )

    def test_webhook_signature_accepts_raw_bytes(self) -> None:
        body = b'{"type":"receipt.issued"}'
        timestamp = "2026-05-25T18:00:00.000Z"
        signature = hmac.new(
            b"whsec_test",
            timestamp.encode("utf-8") + b"." + body,
            sha256,
        ).hexdigest()

        result = verify_webhook_signature_detailed(
            signing_secret="whsec_test",
            signature_header=f" t={timestamp}, v1={signature} ",
            body=body,
            now=datetime(2026, 5, 25, 18, 1, tzinfo=timezone.utc),
        )

        self.assertTrue(result.valid)
        self.assertEqual(result.timestamp, timestamp)

    def test_stale_webhook_signature_rejected(self) -> None:
        body = "{}"
        timestamp = "2026-05-25T18:00:00.000Z"
        signature = hmac.new(
            b"whsec_test",
            f"{timestamp}.{body}".encode("utf-8"),
            sha256,
        ).hexdigest()

        self.assertFalse(
            verify_webhook_signature(
                signing_secret="whsec_test",
                signature_header=f"t={timestamp},v1={signature}",
                body=body,
                now=datetime(2026, 5, 25, 19, 0, tzinfo=timezone.utc),
            )
        )

    def test_stale_webhook_signature_detailed_reason(self) -> None:
        body = "{}"
        timestamp = "2026-05-25T18:00:00.000Z"
        signature = hmac.new(
            b"whsec_test",
            f"{timestamp}.{body}".encode("utf-8"),
            sha256,
        ).hexdigest()

        result = verify_webhook_signature_detailed(
            signing_secret="whsec_test",
            signature_header=f"t={timestamp},v1={signature}",
            body=body,
            now=datetime(2026, 5, 25, 19, 0, tzinfo=timezone.utc),
        )

        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "timestamp_out_of_tolerance")

    def test_bad_webhook_signature_rejected(self) -> None:
        result = verify_webhook_signature_detailed(
            signing_secret="whsec_test",
            signature_header=f"t=2026-05-25T18:00:00.000Z,v1={'0' * 64}",
            body="{}",
            now=datetime(2026, 5, 25, 18, 1, tzinfo=timezone.utc),
        )

        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "invalid_signature")

    def test_malformed_webhook_signature_header_rejected(self) -> None:
        result = verify_webhook_signature_detailed(
            signing_secret="whsec_test",
            signature_header="t=2026-05-25T18:00:00.000Z,not-a-pair",
            body="{}",
        )

        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "malformed_signature_header")

    def test_invalid_webhook_timestamp_rejected(self) -> None:
        result = verify_webhook_signature_detailed(
            signing_secret="whsec_test",
            signature_header=f"t=not-a-date,v1={'0' * 64}",
            body="{}",
        )

        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "invalid_timestamp")
        self.assertEqual(result.timestamp, "not-a-date")

    def test_missing_webhook_signature_header_rejected(self) -> None:
        result = verify_webhook_signature_detailed(
            signing_secret="whsec_test",
            signature_header="",
            body="{}",
        )

        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "missing_signature_header")


if __name__ == "__main__":
    unittest.main()
