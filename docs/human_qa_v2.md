# V2 Remaining Human QA Checklist

Use this for the final manual V2 content-proof pass. Automated sign-off has
already passed.

## Setup

- [*] Pull latest `main`.
- [*] Start local infra, API, worker, desktop, and verifier from `docs/getting-started.md`.
- [*] Run `pnpm eval:seed`.
- [*] Confirm desktop opens.
- [*] Confirm verifier loads at `http://127.0.0.1:3003`.
- [*] Confirm API health is available at `http://127.0.0.1:3001/healthz`.

## Producer Content Proof

- [*] Sign in to desktop as `producer-eval@example.com`.
- [*] Submit a plain text file and confirm desktop shows content proof coverage before submission.
- [*] Submit a native-text PDF and confirm desktop shows `Native PDF text` coverage before submission.
- [*] Confirm the PDF attestation status updates until confirmed.
- [*] Open the confirmed PDF attestation detail.
- [*] Confirm the top summary is compact and shows content proof as available.
- [*] Expand Record and confirm content proof shows `Native PDF text · Standard`.
- [*] Confirm receipt JSON/PDF artifacts still load for the content-proof attestation.

## Verifier Content Lookup

- [*] Grant `verifier-eval@example.com` access to the confirmed PDF attestation.
- [*] Open the verifier lookup link.
- [*] Sign in as `verifier-eval@example.com` if prompted.
- [*] Paste a matching passage from the PDF and verify it matches.
- [*] Confirm the result says `Content match`.
- [*] Confirm the result explains the source passage itself is not included.
- [*] Confirm the hash label says `Matched content proof hash`.
- [*] Paste a clearly unrelated passage and confirm no-match language is understandable.
- [*] Paste fewer than 7 words and confirm the verifier explains that more text is needed.
- [*] Paste a longer paragraph from the PDF and confirm it matches.

## Public Artifacts

- [*] Open the public verification page for a content match.
- [*] Confirm it identifies the result as `Content match`.
- [*] Confirm it uses `text content proof` language, not raw `shingle` jargon.
- [*] Download/open the content match PDF.
- [*] Confirm the PDF says `Content match`.
- [*] Confirm the PDF labels the hash as `Matched content proof hash`.
- [*] Open the public receipt verification page for the attestation.
- [*] Confirm receipt coverage says `text content proof hash(es)`.
- [*] Confirm receipt text extraction says `Native PDF text`.
- [*] Download/open the receipt PDF and confirm the same content-proof language appears.

## Access And Historical Behavior

- [*] Revoke verifier access from the PDF attestation.
- [*] Confirm the verifier can no longer perform a new lookup.
- [*] Confirm the previously issued public verification page still opens.
- [*] Confirm the previously issued public verification PDF still opens.

## Sign-Off

- [*] Known limitations in `docs/v2-known-limitations.md` are accepted.
- [*] All blocking failures are linked to issues or PRs.
- [*] Tester signs off: Drew Shoaf, May 24, 2026.
