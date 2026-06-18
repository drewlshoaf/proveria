from __future__ import annotations

import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from proveria import ProveriaApiError, ProveriaClient, RetryOptions


class FakeResponse:
    def __init__(self, body: bytes | dict, headers: dict[str, str] | None = None):
        self.body = json.dumps(body).encode("utf-8") if isinstance(body, dict) else body
        self.headers = headers or {}

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body

    def close(self) -> None:
        return None


def sample_model_release_record() -> dict:
    return {
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
        "data_provenance": {
            "dataset_manifest_hash": "e" * 64,
        },
        "evaluation": {
            "evaluation_report_hash": "f" * 64,
            "known_limitations": "Monitor for drift.",
        },
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
            "retention_period": "7 years",
        },
    }


def sample_dataset_inventory_record() -> dict:
    return {
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


class ClientTests(unittest.TestCase):
    def test_list_projects_sends_bearer_auth_and_parses_rate_limit_meta(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["headers"] = dict(req.header_items())
            return FakeResponse(
                {
                    "data": [],
                    "meta": {
                        "requestId": "req_1",
                        "pagination": {
                            "limit": 25,
                            "offset": 0,
                            "returned": 0,
                            "hasMore": False,
                        },
                    },
                },
                headers={
                    "RateLimit-Limit": "600",
                    "RateLimit-Remaining": "599",
                    "RateLimit-Reset": "1780689660",
                },
            )

        client = ProveriaClient(
            api_key="prv_v1_test",
            tenant="evaluation-workspace",
            api_url="http://api.test",
        )
        with patch("proveria.client.urlopen", fake_urlopen):
            result = client.projects.list(limit=25, offset=0)

        self.assertEqual(result["data"], [])
        self.assertEqual(
            seen["url"],
            "http://api.test/v1/tenants/evaluation-workspace/projects?limit=25&offset=0",
        )
        self.assertEqual(seen["headers"]["Authorization"], "Bearer prv_v1_test")
        self.assertEqual(result["meta"]["rateLimit"]["remaining"], 599)

    def test_create_project_posts_optional_fields_and_idempotency(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["headers"] = dict(req.header_items())
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"slug": "evidence"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.projects.create(
                slug="evidence",
                name="Evidence",
                visibility="private",
                tags=["qa"],
                idempotency_key="project_1",
            )

        self.assertEqual(seen["url"], "http://api.test/v1/tenants/evaluation-workspace/projects")
        self.assertEqual(seen["headers"]["Idempotency-key"], "project_1")
        self.assertEqual(
            seen["body"],
            {"slug": "evidence", "name": "Evidence", "tags": ["qa"], "visibility": "private"},
        )

    def test_create_hash_attestation_posts_body_and_idempotency(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["headers"] = dict(req.header_items())
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"id": "att_1"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.attestations.create_hash(
                project="evidence",
                label="invoice",
                sha256="A" * 64,
                idempotency_key="idem_1",
            )

        self.assertEqual(
            seen["url"],
            "http://api.test/v1/tenants/evaluation-workspace/projects/evidence/attestations",
        )
        self.assertEqual(seen["headers"]["Idempotency-key"], "idem_1")
        self.assertEqual(seen["body"]["sha256"], "a" * 64)

    def test_create_hash_attestation_accepts_source_metadata(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"id": "att_1"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.attestations.create_hash(
                project="models",
                label="model-release",
                sha256="a" * 64,
                source_metadata={
                    "provider": "model_release",
                    "recordType": "model_provenance_record",
                    "schemaVersion": "0.1",
                    "canonicalHash": "a" * 64,
                    "modelName": "Graduation Model",
                    "modelVersion": "2026.06",
                    "modelType": "classifier",
                    "releaseStage": "production",
                    "claimType": "model_release_approved",
                    "claimText": "Approved.",
                    "claimScope": "full_release_package",
                    "subjectType": "model_artifact",
                    "subjectIdentifier": "registry://models/graduation/2026.06",
                    "subjectHash": "b" * 64,
                    "artifactManifestHash": "c" * 64,
                    "modelCardHash": "d" * 64,
                    "datasetManifestHash": "e" * 64,
                    "evaluationReportHash": "f" * 64,
                    "policyId": "AI-GOV-001",
                    "policyVersion": "2026.1",
                    "policyDecision": "approved",
                    "finalApprover": "Model Risk Committee",
                    "finalApprovalTimestamp": "2026-06-04T18:00:00Z",
                    "disclosureMode": "public_receipt_private_evidence",
                    "verificationPolicy": "verify_model_release_claim",
                },
            )

        self.assertEqual(seen["body"]["sourceMetadata"]["provider"], "model_release")
        self.assertEqual(seen["body"]["sourceMetadata"]["canonicalHash"], "a" * 64)

    def test_create_model_release_attestation_builds_canonical_metadata(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["headers"] = dict(req.header_items())
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"id": "att_model"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.attestations.create_model_release(
                project="models",
                record=sample_model_release_record(),
                label="Graduation Model release",
                idempotency_key="model_1",
            )

        self.assertEqual(
            seen["url"],
            "http://api.test/v1/tenants/evaluation-workspace/projects/models/attestations",
        )
        self.assertEqual(seen["headers"]["Idempotency-key"], "model_1")
        self.assertEqual(seen["body"]["label"], "Graduation Model release")
        self.assertEqual(seen["body"]["fileName"], "model-release.json")
        self.assertRegex(seen["body"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(seen["body"]["sourceMetadata"]["canonicalHash"], seen["body"]["sha256"])
        self.assertEqual(seen["body"]["sourceMetadata"]["modelName"], "Graduation Model")
        self.assertEqual(seen["body"]["sourceMetadata"]["policyId"], "AI-GOV-001")
        self.assertEqual(seen["body"]["sourceMetadata"]["retentionPeriod"], "7 years")

    def test_create_dataset_inventory_attestation_builds_canonical_metadata(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["headers"] = dict(req.header_items())
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"id": "att_dataset"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.attestations.create_dataset_inventory(
                project="datasets",
                record=sample_dataset_inventory_record(),
                label="Training Dataset inventory",
                idempotency_key="dataset_1",
            )

        self.assertEqual(
            seen["url"],
            "http://api.test/v1/tenants/evaluation-workspace/projects/datasets/attestations",
        )
        self.assertEqual(seen["headers"]["Idempotency-key"], "dataset_1")
        self.assertEqual(seen["body"]["label"], "Training Dataset inventory")
        self.assertEqual(seen["body"]["fileName"], "dataset-inventory.json")
        self.assertRegex(seen["body"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(seen["body"]["sourceMetadata"]["canonicalHash"], seen["body"]["sha256"])
        self.assertEqual(seen["body"]["sourceMetadata"]["provider"], "dataset_inventory")
        self.assertEqual(seen["body"]["sourceMetadata"]["datasetName"], "Training Dataset")
        self.assertEqual(seen["body"]["sourceMetadata"]["fileCount"], 2)
        self.assertEqual(seen["body"]["sourceMetadata"]["datasetRootHash"], "b" * 64)
        self.assertEqual(seen["body"]["sourceMetadata"]["retentionRule"], "7 years")

    def test_compatibility_aliases_still_work(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"id": "att_1"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.create_hash_attestation(project="evidence", label="invoice", sha256="b" * 64)

        self.assertEqual(seen["body"]["label"], "invoice")

    def test_verify_hash_posts_lookup(self) -> None:
        seen = {}

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse({"data": {"packageId": "pkg_1"}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.attestations.verify_hash(
                attestation_id="att_1",
                sha256="b" * 64,
                lookup_kind="whole_file",
            )

        self.assertEqual(
            seen["url"],
            "http://api.test/v1/tenants/evaluation-workspace/attestations/att_1/lookup",
        )
        self.assertEqual(
            seen["body"],
            {"submittedHash": "b" * 64, "lookupKind": "whole_file"},
        )

    def test_receipt_artifacts_fetch_json_and_bytes(self) -> None:
        urls: list[str] = []

        def fake_urlopen(req, timeout=30):
            urls.append(req.full_url)
            if req.full_url.endswith(".pdf"):
                return FakeResponse(b"%PDF-1.4")
            return FakeResponse({"receipt": True})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            receipt_json = client.receipts.get_json("att_1")
            receipt_pdf = client.receipts.get_pdf("att_1")

        self.assertEqual(receipt_json, {"receipt": True})
        self.assertEqual(receipt_pdf, b"%PDF-1.4")
        self.assertTrue(urls[0].endswith("/receipt.json"))
        self.assertTrue(urls[1].endswith("/receipt.pdf"))

    def test_events_exports_and_webhooks_paths(self) -> None:
        calls: list[tuple[str, str, dict | None]] = []

        def fake_urlopen(req, timeout=30):
            body = json.loads(req.data.decode("utf-8")) if req.data else None
            calls.append((req.get_method(), req.full_url, body))
            if req.full_url.endswith("/bundle"):
                return FakeResponse({"type": "proveria_evidence_bundle", "counts": {}})
            return FakeResponse({"data": {}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.events.list(category="attestation_lifecycle", limit=10)
            client.evidence_exports.manifest(include_events=True, limit=100)
            client.evidence_exports.create_job(include_events=True, idempotency_key="export_1")
            client.evidence_exports.get_job("job_1")
            client.evidence_exports.get_bundle("job_1")
            client.evidence_exports.list_jobs(limit=5)
            client.webhooks.create_endpoint(
                url="https://example.com/hook",
                events=["receipt.issued"],
                idempotency_key="webhook_1",
            )
            client.webhooks.send_test(endpoint_id="wh_1", idempotency_key="test_1")
            client.webhooks.list_deliveries(offset=10)
            client.webhooks.disable_endpoint("wh_1")

        self.assertEqual(calls[0][0], "GET")
        self.assertIn("/events?category=attestation_lifecycle&limit=10", calls[0][1])
        self.assertEqual(calls[2][2], {"includeEvents": True})
        self.assertTrue(calls[4][1].endswith("/evidence-export/jobs/job_1/bundle"))
        self.assertEqual(calls[6][2], {"url": "https://example.com/hook", "events": ["receipt.issued"]})
        self.assertEqual(calls[-1][0], "DELETE")

    def test_docs_and_api_key_helpers(self) -> None:
        urls: list[str] = []

        def fake_urlopen(req, timeout=30):
            urls.append(req.full_url)
            return FakeResponse({"data": {}, "meta": {}})

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", fake_urlopen):
            client.docs.get_openapi()
            client.docs.get_config()
            client.api_keys.current()

        self.assertEqual(urls[0], "http://api.test/v1/openapi.json")
        self.assertEqual(urls[1], "http://api.test/v1/docs/config.json")
        self.assertEqual(urls[2], "http://api.test/v1/tenants/evaluation-workspace/api-key")

    def test_http_errors_raise_typed_error_properties(self) -> None:
        error = HTTPError(
            "http://api.test",
            404,
            "not found",
            {},
            FakeResponse(
                {
                    "error": {
                        "code": "not_found",
                        "message": "Nope",
                        "retryable": False,
                        "requestId": "req_2",
                        "fieldErrors": [{"field": "slug", "message": "bad"}],
                        "details": {"slug": "missing"},
                    }
                }
            ),
        )

        client = ProveriaClient(api_key="prv_v1_test", tenant="evaluation-workspace", api_url="http://api.test")
        with patch("proveria.client.urlopen", side_effect=error):
            with self.assertRaises(ProveriaApiError) as raised:
                client.projects.list()

        self.assertEqual(raised.exception.code, "not_found")
        self.assertEqual(raised.exception.request_id, "req_2")
        self.assertFalse(raised.exception.retryable)
        self.assertEqual(raised.exception.field_errors[0]["field"], "slug")
        self.assertEqual(raised.exception.details, {"slug": "missing"})

    def test_retries_retryable_api_errors_and_network_errors(self) -> None:
        attempts = {"count": 0}
        retry_events: list[dict] = []

        def fake_urlopen(req, timeout=30):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise HTTPError(
                    "http://api.test",
                    503,
                    "unavailable",
                    {"Retry-After": "0"},
                    FakeResponse(
                        {
                            "error": {
                                "code": "temporarily_unavailable",
                                "message": "Try again",
                                "retryable": True,
                                "requestId": "req_retry",
                            }
                        }
                    ),
                )
            if attempts["count"] == 2:
                raise URLError("network down")
            return FakeResponse({"data": [], "meta": {}})

        client = ProveriaClient(
            api_key="prv_v1_test",
            tenant="evaluation-workspace",
            api_url="http://api.test",
            retry=RetryOptions(
                max_attempts=3,
                base_delay_seconds=0,
                max_delay_seconds=0,
                sleep=lambda _seconds: None,
                on_retry=retry_events.append,
            ),
        )
        with patch("proveria.client.urlopen", fake_urlopen):
            result = client.projects.list()

        self.assertEqual(result["data"], [])
        self.assertEqual(attempts["count"], 3)
        self.assertEqual([event["reason"] for event in retry_events], ["api_error", "network_error"])


if __name__ == "__main__":
    unittest.main()
