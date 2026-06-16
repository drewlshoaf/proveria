# V3 QA Sign-Off Record

Use this record before calling V3 OCR and exact-image evidence
evaluation-ready. Keep issue links next to any failed or accepted item.

## Reviewer

- Name: Drew Shoaf
- Date: May 25, 2026
- Environment:
- Browser:
- Desktop OS:
- Branch or commit: PR #61 (`codex/v3-exact-image-verifier`)

## Automated Gate

Record the result and date for each command:

- [ ] `pnpm smoke:happy-path`
- [ ] `pnpm smoke:pdf-text-layer`
- [ ] `CI=true pnpm --filter @proveria/api typecheck`
- [ ] `CI=true pnpm --filter @proveria/worker typecheck`
- [ ] `CI=true pnpm --filter @proveria/desktop typecheck`
- [ ] `CI=true pnpm --filter @proveria/verifier typecheck`
- [ ] `CI=true pnpm --filter @proveria/api test src/attestations/routes.test.ts`
- [ ] `CI=true pnpm exec vitest run src/pdf/templates/verification-url.test.ts` from `apps/worker`

## Manual Gate

- [*] Complete `docs/human_qa_v3.md` Setup.
- [*] Complete the Producer OCR and Verifier OCR sections.
- [*] Complete the Producer Exact Image and Verifier Exact Image sections.
- [*] Complete Access And Historical Behavior.
- [*] Confirm known limitations in `docs/v3-known-limitations.md` are accepted.

## Defects

Blocking defects:

- None recorded.

Accepted non-blocking limitations:

- None recorded.

## Sign-Off

- [*] All blocking defects are fixed or explicitly accepted.
- [*] OCR and exact image public artifact behavior is accepted.
- [*] V3 OCR and exact-image proof is approved for evaluator use.
