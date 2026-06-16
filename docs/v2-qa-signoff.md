# V2 QA Sign-Off Record

Use this record before calling V2 content proof evaluation-ready. Keep issue
links next to any failed or accepted item.

## Reviewer

- Name:
- Date:
- Environment:
- Browser:
- Desktop OS:
- Branch or commit:

## Automated Gate

Record the result and date for each command:

- [ ] `pnpm smoke:happy-path`
- [ ] `pnpm smoke:pdf-text-layer`
- [ ] `CI=true pnpm --filter @proveria/api typecheck`
- [ ] `CI=true pnpm --filter @proveria/worker typecheck`
- [ ] `CI=true pnpm --filter @proveria/desktop typecheck`
- [ ] `CI=true pnpm --filter @proveria/verifier typecheck`
- [ ] `pnpm --filter @proveria/verifier build`

## Manual Gate

- [ ] Complete `docs/human-qa-checklist.md` Setup.
- [ ] Complete the Producer, Verifier, and Cross-Role sections impacted by V2.
- [ ] Complete the V2 Content Proof section.
- [ ] Confirm known limitations in `docs/v2-known-limitations.md` are accepted.

## Defects

Blocking defects:

- None recorded.

Accepted non-blocking limitations:

- None recorded.

## Sign-Off

- [ ] All blocking defects are fixed or explicitly accepted.
- [ ] Public verification links and historical receipt behavior are accepted.
- [ ] V2 is approved for evaluator use.
