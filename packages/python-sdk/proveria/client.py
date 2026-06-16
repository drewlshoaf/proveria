from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


JsonObject = dict[str, Any]
RetryEvent = dict[str, Any]


@dataclass
class RetryOptions:
    max_attempts: int = 1
    base_delay_seconds: float = 0.25
    max_delay_seconds: float = 2.0
    sleep: Callable[[float], None] | None = None
    on_retry: Callable[[RetryEvent], None] | None = None


@dataclass
class ProveriaApiError(Exception):
    status: int
    body: JsonObject

    def __str__(self) -> str:
        return self.message

    @property
    def error(self) -> JsonObject:
        error = self.body.get("error")
        return error if isinstance(error, dict) else {}

    @property
    def code(self) -> str:
        value = self.error.get("code")
        return value if isinstance(value, str) else "http_error"

    @property
    def message(self) -> str:
        value = self.error.get("message")
        return value if isinstance(value, str) else f"Proveria API request failed with HTTP {self.status}"

    @property
    def retryable(self) -> bool:
        return bool(self.error.get("retryable"))

    @property
    def request_id(self) -> str:
        value = self.error.get("requestId")
        return value if isinstance(value, str) else "unknown"

    @property
    def field_errors(self) -> list[JsonObject]:
        value = self.error.get("fieldErrors")
        return value if isinstance(value, list) else []

    @property
    def details(self) -> JsonObject | None:
        value = self.error.get("details")
        return value if isinstance(value, dict) else None


class ProveriaClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        tenant: str | None = None,
        api_url: str = "http://127.0.0.1:3001",
        retry: RetryOptions | dict[str, Any] | None = None,
    ) -> None:
        self.api_key = api_key
        self.tenant = tenant
        self.api_url = api_url.rstrip("/")
        self.retry = _resolve_retry(retry)

        self.api_keys = ApiKeysApi(self)
        self.docs = DocsApi(self)
        self.projects = ProjectsApi(self)
        self.attestations = AttestationsApi(self)
        self.receipts = ReceiptsApi(self)
        self.events = EventsApi(self)
        self.evidence_exports = EvidenceExportsApi(self)
        self.webhooks = WebhooksApi(self)

    def request(
        self,
        method: str,
        path: str,
        *,
        body: JsonObject | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": f"Bearer {self._require_api_key()}",
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        req = Request(
            f"{self.api_url}{path}",
            data=payload,
            headers=headers,
            method=method,
        )
        return self._send_json(req)

    def public_request(self, path: str) -> JsonObject:
        req = Request(
            f"{self.api_url}{path}",
            headers={"Accept": "application/json"},
            method="GET",
        )
        return self._send_json(req)

    def request_void(self, method: str, path: str) -> None:
        req = Request(
            f"{self.api_url}{path}",
            headers={
                "Authorization": f"Bearer {self._require_api_key()}",
                "Accept": "application/json",
            },
            method=method,
        )
        self._send_json(req)

    def request_json_artifact(self, path: str) -> Any:
        req = Request(
            f"{self.api_url}{path}",
            headers={
                "Authorization": f"Bearer {self._require_api_key()}",
                "Accept": "application/json",
            },
            method="GET",
        )
        return self._send_json(req, expect_envelope=False)

    def request_bytes(self, path: str) -> bytes:
        req = Request(
            f"{self.api_url}{path}",
            headers={
                "Authorization": f"Bearer {self._require_api_key()}",
                "Accept": "application/octet-stream",
            },
            method="GET",
        )
        for attempt in range(1, self.retry.max_attempts + 1):
            try:
                with urlopen(req, timeout=30) as response:
                    return response.read()
            except HTTPError as exc:
                error = ProveriaApiError(exc.code, _normalize_api_error(exc.code, _decode_json(exc.read())))
                if self._should_retry_api_error(error, attempt, _header(exc.headers, "Retry-After")):
                    continue
                raise error from exc
            except URLError as exc:
                if self._should_retry_network_error(attempt):
                    continue
                raise exc
        raise RuntimeError("ProveriaClient retry loop exhausted unexpectedly")

    def tenant_path(self, path: str = "") -> str:
        return f"/v1/tenants/{quote(self._require_tenant())}{path}"

    def list_projects(self, *, limit: int | None = None, offset: int | None = None) -> JsonObject:
        return self.projects.list(limit=limit, offset=offset)

    def create_hash_attestation(
        self,
        *,
        project: str,
        label: str,
        sha256: str,
        description: str | None = None,
        file_name: str | None = None,
        byte_size: int | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        return self.attestations.create_hash(
            project=project,
            label=label,
            sha256=sha256,
            description=description,
            file_name=file_name,
            byte_size=byte_size,
            idempotency_key=idempotency_key,
        )

    def get_attestation(self, attestation_id: str) -> JsonObject:
        return self.attestations.get(attestation_id)

    def verify_hash(
        self,
        *,
        attestation_id: str,
        sha256: str,
        lookup_kind: str | None = None,
    ) -> JsonObject:
        return self.attestations.verify_hash(
            attestation_id=attestation_id,
            sha256=sha256,
            lookup_kind=lookup_kind,
        )

    def get_receipt(self, attestation_id: str) -> JsonObject:
        return self.receipts.get(attestation_id)

    def _send_json(self, req: Request, *, expect_envelope: bool = True) -> JsonObject:
        for attempt in range(1, self.retry.max_attempts + 1):
            try:
                with urlopen(req, timeout=30) as response:
                    parsed = _decode_json(response.read())
                    if expect_envelope:
                        _attach_rate_limit(parsed, response)
                    return parsed
            except HTTPError as exc:
                parsed = _decode_json(exc.read())
                error = ProveriaApiError(exc.code, _normalize_api_error(exc.code, parsed))
                if self._should_retry_api_error(error, attempt, _header(exc.headers, "Retry-After")):
                    continue
                raise error from exc
            except URLError as exc:
                if self._should_retry_network_error(attempt):
                    continue
                raise exc
        raise RuntimeError("ProveriaClient retry loop exhausted unexpectedly")

    def _should_retry_api_error(
        self,
        error: ProveriaApiError,
        attempt: int,
        retry_after: str | None,
    ) -> bool:
        if attempt >= self.retry.max_attempts or not error.retryable:
            return False
        self._wait_for_retry(
            {
                "attempt": attempt,
                "nextAttempt": attempt + 1,
                "maxAttempts": self.retry.max_attempts,
                "reason": "api_error",
                "status": error.status,
                "errorCode": error.code,
            },
            retry_after=retry_after,
        )
        return True

    def _should_retry_network_error(self, attempt: int) -> bool:
        if attempt >= self.retry.max_attempts:
            return False
        self._wait_for_retry(
            {
                "attempt": attempt,
                "nextAttempt": attempt + 1,
                "maxAttempts": self.retry.max_attempts,
                "reason": "network_error",
            }
        )
        return True

    def _wait_for_retry(self, event: RetryEvent, *, retry_after: str | None = None) -> None:
        delay = _retry_delay_seconds(
            event["attempt"],
            base_delay_seconds=self.retry.base_delay_seconds,
            max_delay_seconds=self.retry.max_delay_seconds,
            retry_after=retry_after,
        )
        event["delaySeconds"] = delay
        if self.retry.on_retry:
            self.retry.on_retry(event)
        if delay > 0:
            (self.retry.sleep or time.sleep)(delay)

    def _require_api_key(self) -> str:
        if not self.api_key:
            raise ValueError("ProveriaClient requires api_key for this operation")
        return self.api_key

    def _require_tenant(self) -> str:
        if not self.tenant:
            raise ValueError("ProveriaClient requires tenant for this operation")
        return self.tenant


class ApiKeysApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def current(self) -> JsonObject:
        return self.client.request("GET", self.client.tenant_path("/api-key"))


class DocsApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def get_openapi(self) -> JsonObject:
        return self.client.public_request("/v1/openapi.json")

    def get_config(self) -> JsonObject:
        return self.client.public_request("/v1/docs/config.json")


class ProjectsApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def list(self, *, limit: int | None = None, offset: int | None = None) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/projects{_query(limit=limit, offset=offset)}"),
        )

    def create(
        self,
        *,
        slug: str,
        name: str,
        description: str | None = None,
        classification: str | None = None,
        tags: list[str] | None = None,
        visibility: str | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        body: JsonObject = {"slug": slug, "name": name}
        _set_optional(body, "description", description)
        _set_optional(body, "classification", classification)
        _set_optional(body, "tags", tags)
        _set_optional(body, "visibility", visibility)
        return self.client.request(
            "POST",
            self.client.tenant_path("/projects"),
            body=body,
            idempotency_key=idempotency_key or _generate_idempotency_key(),
        )


class AttestationsApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def list(
        self,
        *,
        project: str | None = None,
        status: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(
                f"/attestations{_query(project=project, status=status, limit=limit, offset=offset)}"
            ),
        )

    def create_hash(
        self,
        *,
        project: str,
        label: str,
        sha256: str,
        description: str | None = None,
        file_name: str | None = None,
        byte_size: int | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        normalized = _normalize_sha256(sha256)
        body: JsonObject = {"label": label, "sha256": normalized}
        _set_optional(body, "description", description)
        _set_optional(body, "fileName", file_name)
        if byte_size is not None:
            if byte_size < 0:
                raise ValueError("byte_size must be non-negative")
            body["byteSize"] = byte_size
        return self.client.request(
            "POST",
            self.client.tenant_path(f"/projects/{quote(project)}/attestations"),
            body=body,
            idempotency_key=idempotency_key or _generate_idempotency_key(),
        )

    def get(self, attestation_id: str) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/attestations/{quote(attestation_id)}"),
        )

    def verify_hash(
        self,
        *,
        attestation_id: str,
        sha256: str,
        lookup_kind: str | None = None,
    ) -> JsonObject:
        normalized = _normalize_sha256(sha256)
        body: JsonObject = {"submittedHash": normalized}
        if lookup_kind:
            if lookup_kind not in {"whole_file", "content", "exact_image", "any"}:
                raise ValueError("lookup_kind must be whole_file, content, exact_image, or any")
            body["lookupKind"] = lookup_kind
        return self.client.request(
            "POST",
            self.client.tenant_path(f"/attestations/{quote(attestation_id)}/lookup"),
            body=body,
        )

    def grant_verifier_access(
        self,
        *,
        attestation_id: str,
        email: str,
        message: str | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        body: JsonObject = {"email": email}
        _set_optional(body, "message", message)
        return self.client.request(
            "POST",
            self.client.tenant_path(f"/attestations/{quote(attestation_id)}/verifier-access"),
            body=body,
            idempotency_key=idempotency_key or _generate_idempotency_key(),
        )

    def revoke_verifier_access(self, *, attestation_id: str, grant_id: str) -> None:
        self.client.request_void(
            "DELETE",
            self.client.tenant_path(
                f"/attestations/{quote(attestation_id)}/verifier-access/{quote(grant_id)}"
            ),
        )


class ReceiptsApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def get(self, attestation_id: str) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/attestations/{quote(attestation_id)}/receipt"),
        )

    def get_json(self, attestation_id: str) -> Any:
        return self.client.request_json_artifact(
            self.client.tenant_path(f"/attestations/{quote(attestation_id)}/receipt.json")
        )

    def get_pdf(self, attestation_id: str) -> bytes:
        return self.client.request_bytes(
            self.client.tenant_path(f"/attestations/{quote(attestation_id)}/receipt.pdf")
        )


class EventsApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def list(
        self,
        *,
        category: str | None = None,
        action: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(
                f"/events{_query(category=category, action=action, targetType=target_type, targetId=target_id, limit=limit, offset=offset)}"
            ),
        )


class EvidenceExportsApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def manifest(
        self,
        *,
        project_id: str | None = None,
        actor_user_id: str | None = None,
        include_events: bool | None = None,
        limit: int | None = None,
    ) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(
                f"/evidence-export/manifest{_query(projectId=project_id, actorUserId=actor_user_id, includeEvents=include_events, limit=limit)}"
            ),
        )

    def create_job(
        self,
        *,
        project_id: str | None = None,
        actor_user_id: str | None = None,
        include_events: bool | None = None,
        limit: int | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        body: JsonObject = {}
        _set_optional(body, "projectId", project_id)
        _set_optional(body, "actorUserId", actor_user_id)
        _set_optional(body, "includeEvents", include_events)
        _set_optional(body, "limit", limit)
        return self.client.request(
            "POST",
            self.client.tenant_path("/evidence-export/jobs"),
            body=body,
            idempotency_key=idempotency_key or _generate_idempotency_key(),
        )

    def get_job(self, job_id: str) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/evidence-export/jobs/{quote(job_id)}"),
        )

    def get_bundle(self, job_id: str) -> JsonObject:
        raw = self.client.request_bytes(
            self.client.tenant_path(f"/evidence-export/jobs/{quote(job_id)}/bundle")
        )
        return _decode_json(raw)

    def list_jobs(self, *, limit: int | None = None, offset: int | None = None) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/evidence-export/jobs{_query(limit=limit, offset=offset)}"),
        )


class WebhooksApi:
    def __init__(self, client: ProveriaClient) -> None:
        self.client = client

    def list_endpoints(self, *, limit: int | None = None, offset: int | None = None) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/webhook-endpoints{_query(limit=limit, offset=offset)}"),
        )

    def create_endpoint(
        self,
        *,
        url: str,
        events: list[str],
        description: str | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        body: JsonObject = {"url": url, "events": events}
        _set_optional(body, "description", description)
        return self.client.request(
            "POST",
            self.client.tenant_path("/webhook-endpoints"),
            body=body,
            idempotency_key=idempotency_key or _generate_idempotency_key(),
        )

    def disable_endpoint(self, endpoint_id: str) -> None:
        self.client.request_void(
            "DELETE",
            self.client.tenant_path(f"/webhook-endpoints/{quote(endpoint_id)}"),
        )

    def send_test(self, *, endpoint_id: str, idempotency_key: str | None = None) -> JsonObject:
        return self.client.request(
            "POST",
            self.client.tenant_path(f"/webhook-endpoints/{quote(endpoint_id)}/test"),
            idempotency_key=idempotency_key or _generate_idempotency_key(),
        )

    def list_deliveries(self, *, limit: int | None = None, offset: int | None = None) -> JsonObject:
        return self.client.request(
            "GET",
            self.client.tenant_path(f"/webhook-deliveries{_query(limit=limit, offset=offset)}"),
        )


def _resolve_retry(retry: RetryOptions | dict[str, Any] | None) -> RetryOptions:
    if retry is None:
        return RetryOptions()
    if isinstance(retry, RetryOptions):
        return RetryOptions(
            max_attempts=max(1, int(retry.max_attempts)),
            base_delay_seconds=max(0.0, float(retry.base_delay_seconds)),
            max_delay_seconds=max(0.0, float(retry.max_delay_seconds)),
            sleep=retry.sleep,
            on_retry=retry.on_retry,
        )
    return RetryOptions(
        max_attempts=max(1, int(retry.get("max_attempts", 1))),
        base_delay_seconds=max(0.0, float(retry.get("base_delay_seconds", 0.25))),
        max_delay_seconds=max(0.0, float(retry.get("max_delay_seconds", 2.0))),
        sleep=retry.get("sleep"),
        on_retry=retry.get("on_retry"),
    )


def _retry_delay_seconds(
    attempt: int,
    *,
    base_delay_seconds: float,
    max_delay_seconds: float,
    retry_after: str | None = None,
) -> float:
    parsed_retry_after = _parse_retry_after_seconds(retry_after)
    if parsed_retry_after is not None:
        return min(parsed_retry_after, max_delay_seconds)
    return min(base_delay_seconds * 2 ** max(0, attempt - 1), max_delay_seconds)


def _parse_retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _decode_json(raw: bytes) -> JsonObject:
    if not raw:
        return {}
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("expected JSON object response")
    return parsed


def _normalize_api_error(status: int, parsed: JsonObject) -> JsonObject:
    if isinstance(parsed.get("error"), dict):
        return parsed
    return {
        "error": {
            "code": "http_error",
            "message": f"Request failed with HTTP {status}.",
            "retryable": status >= 500,
            "requestId": "unknown",
        }
    }


def _attach_rate_limit(parsed: JsonObject, response: Any) -> None:
    if not isinstance(parsed.get("meta"), dict):
        return
    headers = getattr(response, "headers", None)
    rate_limit = _response_rate_limit(headers)
    if rate_limit is not None:
        parsed["meta"]["rateLimit"] = rate_limit


def _response_rate_limit(headers: Any) -> JsonObject | None:
    if headers is None:
        return None
    if _header(headers, "RateLimit-Limit") is None and _header(headers, "ratelimit-limit") is None:
        return None
    return {
        "limit": _parse_int_header(headers, "RateLimit-Limit"),
        "remaining": _parse_int_header(headers, "RateLimit-Remaining"),
        "reset": _parse_int_header(headers, "RateLimit-Reset"),
    }


def _parse_int_header(headers: Any, name: str) -> int | None:
    value = _header(headers, name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _header(headers: Any, name: str) -> str | None:
    if headers is None:
        return None
    if hasattr(headers, "get"):
        value = headers.get(name)
        if value is None:
            value = headers.get(name.lower())
        if value is None:
            return None
        return str(value)
    return None


def _query(**values: Any) -> str:
    filtered = {key: str(value).lower() if isinstance(value, bool) else value for key, value in values.items() if value is not None}
    return f"?{urlencode(filtered)}" if filtered else ""


def _set_optional(body: JsonObject, key: str, value: Any) -> None:
    if value is not None:
        body[key] = value


def _normalize_sha256(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) != 64 or any(c not in "0123456789abcdef" for c in normalized):
        raise ValueError("expected a 64-character SHA-256 hex string")
    return normalized


def _generate_idempotency_key() -> str:
    return f"python_sdk_{int(time.time() * 1000)}_{uuid.uuid4().hex}"
