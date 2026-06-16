from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256


WebhookVerificationFailureReason = str


@dataclass(frozen=True)
class WebhookVerificationResult:
    valid: bool
    reason: WebhookVerificationFailureReason | None = None
    timestamp: str | None = None
    age_seconds: float | None = None


def verify_webhook_signature(
    *,
    signing_secret: str,
    signature_header: str,
    body: bytes | str,
    tolerance_seconds: int = 300,
    now: datetime | None = None,
) -> bool:
    return verify_webhook_signature_detailed(
        signing_secret=signing_secret,
        signature_header=signature_header,
        body=body,
        tolerance_seconds=tolerance_seconds,
        now=now,
    ).valid


def verify_webhook_signature_detailed(
    *,
    signing_secret: str,
    signature_header: str,
    body: bytes | str,
    tolerance_seconds: int = 300,
    now: datetime | None = None,
) -> WebhookVerificationResult:
    parsed = _parse_signature_header(signature_header)
    if parsed.reason:
        return WebhookVerificationResult(valid=False, reason=parsed.reason)
    if not parsed.timestamp:
        return WebhookVerificationResult(valid=False, reason="missing_timestamp")
    if not parsed.signature:
        return WebhookVerificationResult(valid=False, reason="missing_signature")

    issued_at = _parse_timestamp(parsed.timestamp)
    if issued_at is None:
        return WebhookVerificationResult(
            valid=False,
            reason="invalid_timestamp",
            timestamp=parsed.timestamp,
        )

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    age_seconds = abs((current - issued_at).total_seconds())
    if age_seconds > tolerance_seconds:
        return WebhookVerificationResult(
            valid=False,
            reason="timestamp_out_of_tolerance",
            timestamp=parsed.timestamp,
            age_seconds=age_seconds,
        )

    body_bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    expected = hmac.new(
        signing_secret.encode("utf-8"),
        parsed.timestamp.encode("utf-8") + b"." + body_bytes,
        sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, parsed.signature):
        return WebhookVerificationResult(
            valid=False,
            reason="invalid_signature",
            timestamp=parsed.timestamp,
            age_seconds=age_seconds,
        )

    return WebhookVerificationResult(
        valid=True,
        timestamp=parsed.timestamp,
        age_seconds=age_seconds,
    )


@dataclass(frozen=True)
class _ParsedSignatureHeader:
    timestamp: str | None = None
    signature: str | None = None
    reason: WebhookVerificationFailureReason | None = None


def _parse_signature_header(header: str) -> _ParsedSignatureHeader:
    if not header.strip():
        return _ParsedSignatureHeader(reason="missing_signature_header")

    timestamp: str | None = None
    signature: str | None = None
    for part in header.split(","):
        key, separator, value = part.partition("=")
        key = key.strip()
        value = value.strip()
        if not key or not separator or not value:
            return _ParsedSignatureHeader(reason="malformed_signature_header")
        if key == "t":
            timestamp = value
        if key == "v1":
            signature = value
    return _ParsedSignatureHeader(timestamp=timestamp, signature=signature)


def _parse_timestamp(value: str) -> datetime | None:
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None
