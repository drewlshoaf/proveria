# Human QA Checklist

Use this as the final manual gate before calling the current desktop-first
version shippable. Record tester name, date, environment, browser, and any issue
links for failed items.

## Setup

- [ ] Start local infra, API, worker, desktop, and verifier from `docs/getting-started.md`.
- [ ] Run `pnpm eval:seed` and confirm seeded accounts are available.
- [ ] Confirm desktop opens and verifier web client loads at `http://127.0.0.1:3003`.
- [ ] Confirm API health is available at `http://127.0.0.1:3001/healthz`.
- [ ] Confirm the worker is running before testing attestation confirmation, receipts, or PDFs.

## Admin Producer

- [ ] Sign in to desktop as `admin-producer-eval@example.com`.
- [ ] Confirm the current desktop appears in trusted devices.
- [ ] Confirm Account shows members, pending invitations, and invite controls.
- [ ] Create a project and confirm the slug auto-generates from the name.
- [ ] Confirm project slugs allow lowercase letters, numbers, and dashes.
- [ ] Confirm invalid project slug input is blocked clearly.
- [ ] Confirm duplicate project slug shows a clear error.
- [ ] Open a project from Projects and confirm it shows that project's attestations.
- [ ] Archive and restore a project.
- [ ] Invite a producer.
- [ ] Invite an admin.
- [ ] Revoke a pending invitation.
- [ ] Remove a non-admin member.
- [ ] Confirm the current user cannot remove their own workspace access.
- [ ] Confirm full workspace audit events appear in the Audit table.
- [ ] Confirm Audit search, category filter, sort, refresh, and paging work.
- [ ] Revoke another trusted device if available.

## Producer

- [ ] Sign in as `producer-eval@example.com`.
- [ ] Confirm admin-only member and invitation controls are hidden.
- [ ] Create a project and confirm the slug auto-generates from the name.
- [ ] Open a project from Projects and confirm it shows that project's attestations.
- [ ] Submit one attestation by choosing a local file.
- [ ] Submit multiple file attestations in one batch.
- [ ] Submit an attestation by pasting an external SHA-256.
- [ ] Confirm invalid SHA-256 input blocks submission clearly.
- [ ] Confirm duplicate attestation label shows a clear error.
- [ ] Confirm status updates until receipt is available.
- [ ] Confirm newly submitted rows show a details link once confirmed.
- [ ] Confirm the attestation table supports search, project filter, status filter, sorting, paging, and refresh.
- [ ] Confirm recent local attestations appears on Overview.
- [ ] Open a recent local attestation and confirm the correct detail loads.
- [ ] On Attestation Detail, confirm the Record section shows status, attestation id, package id, Merkle root, and receipt availability.
- [ ] On Attestation Detail, confirm the Receipt section shows public receipt link, verifier lookup link, attempts, receipt proof, and JSON preview.
- [ ] Open the public receipt verification page from the Receipt section.
- [ ] Open the receipt PDF from the Receipt section.
- [ ] Copy the public receipt link from the Receipt section.
- [ ] On Attestation Detail, grant verifier access from the Access section.
- [ ] On Attestation Detail, revoke verifier access from the Access section.
- [ ] On Attestation Detail, confirm related audit events appear in the Audit section.
- [ ] Confirm limited producer audit events appear in the Audit table.
- [ ] Confirm Audit search, category filter, sort, refresh, and paging work for a producer.

## Verifier

- [ ] Open a verifier lookup link while signed out.
- [ ] Sign in as `verifier-eval@example.com`.
- [ ] Confirm sign-in returns to the original lookup link.
- [ ] Verify a matching file using browser-side file hashing.
- [ ] Verify a matching pasted SHA-256.
- [ ] Verify a non-matching pasted SHA-256.
- [ ] Confirm match result language is understandable.
- [ ] Confirm no-match result language is understandable.
- [ ] Open the public verification page for a match result.
- [ ] Open the public verification page for a no-match result.
- [ ] Confirm public verification pages load without requiring sign-in.
- [ ] Confirm JSON and PDF artifacts are available where expected.
- [ ] Confirm copied public verification links reopen the same result.

## V2 Content Proof

- [ ] Submit a plain text file and confirm desktop shows content proof coverage before submission.
- [ ] Submit a native-text PDF and confirm desktop shows Native PDF text coverage before submission.
- [ ] Open the confirmed PDF attestation and confirm Attestation Detail shows content proof is available.
- [ ] Grant verifier access to the PDF attestation and open the verifier lookup link.
- [ ] Verify a matching PDF passage using browser-side passage hashing.
- [ ] Verify a clearly unrelated passage and confirm the no-match language is understandable.
- [ ] Paste a passage shorter than 7 words and confirm the verifier explains that more text is needed.
- [ ] Paste a longer paragraph from the PDF and confirm it matches.
- [ ] Open the public verification page for a content match and confirm it identifies the result as content proof.
- [ ] Confirm receipt JSON/PDF artifacts still load for the content-proof attestation.

## Cross-Role End To End

- [ ] Producer creates a new project.
- [ ] Producer submits a whole-file attestation.
- [ ] Producer waits for confirmation.
- [ ] Producer opens receipt proof and public receipt PDF.
- [ ] Producer grants verifier access.
- [ ] Verifier performs a match lookup.
- [ ] Verifier performs a no-match lookup.
- [ ] Verifier opens public verification page and PDF for issued results.
- [ ] Producer revokes verifier access.
- [ ] Verifier can no longer perform a new lookup after revocation.
- [ ] Previously issued public verification page still verifies if expected.

## Negative And Edge Cases

- [ ] Wrong desktop login credentials show a clear error.
- [ ] Verifier-only account is blocked from desktop sign-in.
- [ ] Producer cannot access admin-only APIs through the UI.
- [ ] Duplicate project slug shows a clear error.
- [ ] Archived project does not appear in the attestation project picker.
- [ ] Archived project cannot receive a new attestation.
- [ ] Current-device sign-out revokes local access and returns to sign-in.
- [ ] API unavailable state is understandable in desktop.
- [ ] Verifier missing access state is understandable.
- [ ] Verifier revoked access state is understandable.

## Sign-Off

- [ ] All blocking failures are linked to issues or PRs.
- [ ] Non-blocking known limitations are documented.
- [ ] Tester signs off with name and date.
