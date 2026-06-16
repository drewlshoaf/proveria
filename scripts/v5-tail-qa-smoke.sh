#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="${V5_QA_OUT:-$ROOT_DIR/.qa/v5-tail-$(date +%Y%m%d-%H%M%S)}"
DATABASE_URL="${DATABASE_URL:-postgres://proveria:proveria_dev@localhost:5432/proveria}"
VERIFIER_URL="${PROVERIA_VERIFIER_URL:-http://127.0.0.1:3003}"

if [[ -n "${PROVERIA_CLI:-}" ]]; then
  CLI_CMD=("$PROVERIA_CLI")
  CLI_LABEL="$PROVERIA_CLI"
else
  CLI_CMD=(cargo run -q -p proveria --)
  CLI_LABEL="cargo run -q -p proveria --"
fi

log() {
  printf '\n==> %s\n' "$*"
}

pass() {
  printf 'PASS: %s\n' "$*"
}

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -s "$path" ]] || fail "expected non-empty file: $path"
  pass "found $(realpath "$path")"
}

json_read() {
  local file="$1"
  local expression="$2"
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const value = (${expression})(data);
if (value === undefined || value === null) process.exit(2);
if (typeof value === 'object') console.log(JSON.stringify(value));
else console.log(String(value));
" "$file"
}

json_assert() {
  local file="$1"
  local expression="$2"
  local label="$3"
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (!((${expression})(data))) {
  console.error(process.argv[2]);
  process.exit(1);
}
" "$file" "$label" || fail "$label"
  pass "$label"
}

proveria_cli() {
  "${CLI_CMD[@]}" "$@"
}

wait_export_job_completed() {
  local job_id="$1"
  local output="$2"
  local status
  for _ in $(seq 1 60); do
    proveria_cli export get "$job_id" --format json > "$output"
    status="$(json_read "$output" "d => d.data.job.status")"
    if [[ "$status" == "completed" ]]; then
      pass "export job $job_id completed"
      return 0
    fi
    if [[ "$status" == "failed" ]]; then
      fail "export job $job_id failed"
    fi
    sleep 1
  done
  fail "export job $job_id did not complete before timeout"
}

log "preflight"
mkdir -p "$OUT_DIR"
proveria_cli export --help | grep -q ' get ' ||
  fail "$CLI_LABEL does not support 'proveria export get'; set PROVERIA_CLI or run pnpm cli:install"
CONFIG_JSON="$(proveria_cli config show)"
API_URL="${PROVERIA_API_URL:-$(CONFIG_JSON="$CONFIG_JSON" node -e "const c=JSON.parse(process.env.CONFIG_JSON); console.log(c.api_url || '')")}"
WORKSPACE="${PROVERIA_WORKSPACE:-$(CONFIG_JSON="$CONFIG_JSON" node -e "const c=JSON.parse(process.env.CONFIG_JSON); console.log(c.workspace || '')")}"
API_KEY="${PROVERIA_API_KEY:-$(CONFIG_JSON="$CONFIG_JSON" node -e "const c=JSON.parse(process.env.CONFIG_JSON); console.log(c.api_key || '')")}"
SESSION_COOKIE="$(CONFIG_JSON="$CONFIG_JSON" node -e "const c=JSON.parse(process.env.CONFIG_JSON); console.log(c.session_cookie || '')")"
[[ -n "$API_URL" ]] || fail "missing API URL; run proveria config set or set PROVERIA_API_URL"
[[ -n "$WORKSPACE" ]] || fail "missing workspace; run proveria config set or set PROVERIA_WORKSPACE"
[[ -n "$API_KEY" ]] || fail "missing API key; run proveria config set or set PROVERIA_API_KEY"
[[ -n "$SESSION_COOKIE" ]] || fail "missing admin session cookie; run proveria auth login as admin-producer-eval@example.com"
pass "using CLI $CLI_LABEL"
pass "using workspace $WORKSPACE"
pass "writing QA artifacts to $OUT_DIR"

log "setup smoke"
if [[ "${V5_QA_SKIP_SEED:-0}" != "1" ]]; then
  pnpm eval:seed > "$OUT_DIR/eval-seed.log"
  pass "pnpm eval:seed completed"
else
  pass "skipped pnpm eval:seed because V5_QA_SKIP_SEED=1"
fi
curl -fsS "$API_URL/healthz" -o "$OUT_DIR/api-health.json"
pass "API health is available"
curl -fsS "$VERIFIER_URL" -o "$OUT_DIR/verifier.html"
grep -qi 'Proveria' "$OUT_DIR/verifier.html"
pass "verifier loads at $VERIFIER_URL"

log "OpenAPI loads"
OPENAPI_JSON="$OUT_DIR/openapi.json"
curl -fsS "$API_URL/v1/openapi.json" -o "$OPENAPI_JSON"
json_assert "$OPENAPI_JSON" "d => d.openapi && d.info && d.paths" "/v1/openapi.json has OpenAPI shape"

log "collect evidence export package"
COLLECT_DIR="$OUT_DIR/tmp-evidence-collect"
COLLECT_ZIP="$OUT_DIR/tmp-evidence-collect.zip"
COLLECT_TAR="$OUT_DIR/tmp-evidence-collect.tar"
proveria_cli export collect \
  --limit 100 \
  --output "$COLLECT_DIR" \
  --zip "$COLLECT_ZIP" \
  --tar "$COLLECT_TAR" \
  --format json \
  > "$OUT_DIR/export-collect.json"
require_file "$COLLECT_DIR/bundle.json"
require_file "$COLLECT_DIR/manifest.json"
require_file "$COLLECT_DIR/summary.json"
require_file "$COLLECT_ZIP"
require_file "$COLLECT_TAR"
json_assert "$OUT_DIR/export-collect.json" "d => d.job && d.job.id && d.job.status === 'completed'" "collect created a completed job"
json_assert "$OUT_DIR/export-collect.json" "d => d.unpackedArtifactCount > 0" "collect unpacked artifact files"
COLLECT_JOB_ID="$(json_read "$OUT_DIR/export-collect.json" "d => d.job.id")"
PROJECT_ID="$(json_read "$COLLECT_DIR/manifest.json" "d => d.attestations && d.attestations[0] && d.attestations[0].project && d.attestations[0].project.id")"
ACTOR_USER_ID="$(json_read "$COLLECT_DIR/manifest.json" "d => d.attestations && d.attestations.find(a => a.createdByUserId)?.createdByUserId")"

log "event export files"
TODAY_UTC="$(date -u +%Y-%m-%d)"
curl -fsS \
  -H "cookie: $SESSION_COOKIE" \
  "$API_URL/tenants/$WORKSPACE/audit/export?format=json&limit=100" \
  -o "$OUT_DIR/events-export.json"
json_assert "$OUT_DIR/events-export.json" "d => d.export && d.export.format === 'json' && Array.isArray(d.events)" "events export JSON downloads"
curl -fsS \
  -H "cookie: $SESSION_COOKIE" \
  "$API_URL/tenants/$WORKSPACE/audit/export?format=csv&limit=100" \
  -o "$OUT_DIR/events-export.csv"
grep -q 'id,createdAt,category,action' "$OUT_DIR/events-export.csv"
pass "events export CSV downloads"
curl -fsS \
  -H "cookie: $SESSION_COOKIE" \
  "$API_URL/tenants/$WORKSPACE/audit/export?format=json&category=attestation_lifecycle&actorUserId=$ACTOR_USER_ID&projectId=$PROJECT_ID&from=2026-01-01&to=$TODAY_UTC&limit=100" \
  -o "$OUT_DIR/events-export-filtered.json"
json_assert "$OUT_DIR/events-export-filtered.json" "d => d.export && d.export.filters.category === 'attestation_lifecycle' && d.export.filters.actorUserId && d.export.filters.projectId && d.export.filters.from && d.export.filters.to" "events export accepts category, project, actor, and date filters"

log "check collected package and standalone bundle"
proveria_cli export check "$COLLECT_DIR" --output json > "$OUT_DIR/check-collect.json"
proveria_cli export check "$COLLECT_DIR/bundle.json" --output json > "$OUT_DIR/check-bundle.json"
json_assert "$OUT_DIR/check-collect.json" "d => d.valid === true && d.kind === 'directory' && d.checkedFiles.length >= 2" "collected directory package is valid"
json_assert "$OUT_DIR/check-bundle.json" "d => d.valid === true && d.kind === 'bundle' && d.checkedFiles.length === 1" "standalone bundle is valid"

log "filtered evidence export jobs"
proveria_cli export create --project-id "$PROJECT_ID" --limit 100 --format json > "$OUT_DIR/export-project-filter.json"
proveria_cli export create --actor-user-id "$ACTOR_USER_ID" --limit 100 --format json > "$OUT_DIR/export-actor-filter.json"
json_assert "$OUT_DIR/export-project-filter.json" "d => d.data.job.id && d.data.manifest.export.filters.projectId" "project-filtered export was accepted"
json_assert "$OUT_DIR/export-actor-filter.json" "d => d.data.job.id && d.data.manifest.export.filters.actorUserId" "actor-filtered export was accepted"
PROJECT_JOB_ID="$(json_read "$OUT_DIR/export-project-filter.json" "d => d.data.job.id")"
ACTOR_JOB_ID="$(json_read "$OUT_DIR/export-actor-filter.json" "d => d.data.job.id")"
wait_export_job_completed "$PROJECT_JOB_ID" "$OUT_DIR/export-project-filter-completed.json"
wait_export_job_completed "$ACTOR_JOB_ID" "$OUT_DIR/export-actor-filter-completed.json"

log "recent export jobs list contains newly-created jobs"
proveria_cli export jobs --limit 20 --output json > "$OUT_DIR/export-jobs.json"
json_assert "$OUT_DIR/export-jobs.json" "d => d.data.some(j => j.id === '$COLLECT_JOB_ID')" "jobs list contains collect job"
json_assert "$OUT_DIR/export-jobs.json" "d => d.data.some(j => j.id === '$PROJECT_JOB_ID')" "jobs list contains project-filtered job"
json_assert "$OUT_DIR/export-jobs.json" "d => d.data.some(j => j.id === '$ACTOR_JOB_ID')" "jobs list contains actor-filtered job"

log "evidence export events appear"
proveria_cli events --category audit_integrity --action audit_export.created --limit 20 --output json > "$OUT_DIR/audit-export-events.json"
json_assert "$OUT_DIR/audit-export-events.json" "d => d.data && d.data.some(e => e.action === 'audit_export.created')" "audit_export.created events are visible"
proveria_cli events --category evidence_export --action evidence_export.created --limit 20 --output json > "$OUT_DIR/evidence-export-events.json"
json_assert "$OUT_DIR/evidence-export-events.json" "d => d.data && d.data.some(e => e.action === 'evidence_export.created')" "evidence_export.created events are visible"

log "expired evidence export cleanup"
CLEANUP_JOB_ID="$(psql "$DATABASE_URL" -XqAtc "
WITH t AS (
  SELECT id FROM public.tenants WHERE slug = '$WORKSPACE' LIMIT 1
),
u AS (
  SELECT created_by_user_id AS id
  FROM public.api_keys
  WHERE key_hash IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
)
INSERT INTO public.export_jobs (
  tenant_id,
  created_by_user_id,
  kind,
  status,
  filters,
  manifest,
  artifact_count,
  row_count,
  result_object_key,
  completed_at,
  expires_at,
  retention_policy
)
SELECT
  t.id,
  u.id,
  'evidence_export',
  'completed',
  '{}'::jsonb,
  '{\"export\":{\"type\":\"evidence_export_job_manifest\",\"counts\":{}}}'::jsonb,
  1,
  1,
  'qa/expired-evidence-export/' || gen_random_uuid() || '/bundle.json',
  now() - interval '2 days',
  now() - interval '1 day',
  '{\"retention_days\":0,\"delete_after_expiration\":true}'::jsonb
FROM t LEFT JOIN u ON true
RETURNING id;")"
[[ -n "$CLEANUP_JOB_ID" ]] || fail "could not seed expired export job"
curl -fsS \
  -X POST \
  -H "authorization: Bearer $API_KEY" \
  "$API_URL/v1/tenants/$WORKSPACE/evidence-export/jobs/cleanup-expired" \
  -o "$OUT_DIR/cleanup-expired.json"
json_assert "$OUT_DIR/cleanup-expired.json" "d => d.data && d.data.deleted >= 1" "cleanup deleted at least one expired export object"
CLEANUP_DB_JSON="$OUT_DIR/cleanup-db.json"
psql "$DATABASE_URL" -XqAtc "
SELECT json_build_object(
  'status', status,
  'resultObjectKey', result_object_key,
  'auditCount', (
    SELECT count(*)
    FROM audit.audit_events
    WHERE action = 'evidence_export.expired'
      AND category = 'retention_deletion'
      AND target_type = 'evidence_export_job'
      AND target_id = public.export_jobs.id::text
  )
)::text
FROM public.export_jobs
WHERE id = '$CLEANUP_JOB_ID';" > "$CLEANUP_DB_JSON"
json_assert "$CLEANUP_DB_JSON" "d => d.status === 'expired' && d.resultObjectKey === null && Number(d.auditCount) >= 1" "cleanup marked job expired, cleared object key, and wrote audit event"

log "developer surface tests"
pnpm cli:test
pnpm --filter @proveria/sdk test

log "documentation language checks"
grep -qi 'supported' docs/v5-webhook-catalog.md
grep -qi 'deferred' docs/v5-webhook-catalog.md
grep -qi 'receipt' docs/v5-public-developer-language.md
grep -qi 'verification result' docs/v5-public-developer-language.md
grep -qi 'private verifier lookup' docs/v5-public-developer-language.md
grep -qi 'Google Drive Picker-based browsing' docs/v5-known-limitations.md
grep -qi 'Generic OIDC authentication is implemented' docs/v5-known-limitations.md
grep -qi 'Drive privacy behavior is intentionally local-first' docs/v5-known-limitations.md
grep -qi 'Automatic scheduling remains an operational follow-up' docs/v5-known-limitations.md
grep -qi 'Webhook event coverage remains intentionally narrow' docs/v5-known-limitations.md
grep -qi 'Microsoft Entra' docs/v5-entra-oidc-local-setup.md
grep -qi 'Google' docs/v5-google-oidc-local-setup.md
pass "V5 developer/limitations docs contain expected language"

cat <<EOF

Automated V5 remaining-QA smoke passed.

Artifacts:
  $OUT_DIR

Automated coverage from the full checklist:
  Setup:
    - pnpm eval:seed, unless V5_QA_SKIP_SEED=1
    - verifier page load
    - API /healthz
  Events And Exports:
    - Events JSON export
    - Events CSV export
    - Events export filters for category, project, actor, and date range
    - log export audit events
    - evidence export collect/check/filter/jobs/events
    - expired evidence export cleanup and retention audit event
  Developer Surface Smoke:
    - /v1/openapi.json
    - pnpm cli:test
    - pnpm --filter @proveria/sdk test
    - V5 webhook and developer language docs
  Accepted Limitations:
    - known limitations, Entra setup, Google OIDC setup, generic OIDC,
      Drive Picker deferral, explicit cleanup, and broader webhook deferral

Still manual / visual from the full checklist:
  Setup:
    - pull latest main
    - run database migrations
    - start local services
    - desktop opens and signs in
  Core Regression Pass:
    - desktop attestation creation/progress/detail/reset/template UX
    - verifier grant/request table UX
    - approve/deny verifier request UX
    - handoff language visual confirmation
  Workspace And Admin Pass:
    - admin sign-in and workspace switching UX
    - workspace creation and project scoping UX
    - Users/User Detail access-control UX
    - member access revoke/self-protection UX
    - receipt/result wording visual review
  Events And Exports:
    - Events table search/filter/sort/refresh/paging/detail-row UX
    - desktop evidence export manifest/bundle download buttons
    - organization-scoped evidence export visual confirmation
    - Recent evidence exports refresh button visual behavior
  Google Drive Local Import:
    - full local file picker and Drive metadata UI flow
  Verifier Regression:
    - private lookup signed-out redirect/sign-in return
    - browser hash/passage verification UX
    - public result/receipt pages and PDF rendering
  Sign-Off:
    - issue links, accepted non-blockers, tester name/date
EOF
