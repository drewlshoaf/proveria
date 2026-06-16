# V1 QA Sign-Off Record

Use this file to record the human sign-off for the first desktop-first
evaluatable build. Do not check the final shippability boxes in
`docs/v1-completion-checklist.md` until this record is filled in.

## Release Candidate

- Candidate branch or tag:
- Commit SHA:
- Date:
- Reviewer:
- Environment:
- Operating system:
- Browser:

## Automated Release Check

Run:

```sh
pnpm v1:release-check
```

Record the result:

- [ ] Passed
- Run started:
- Run completed:
- Notes:

This command runs typechecks, API/worker/desktop tests, verifier build,
local infra startup, database migrations, verifier responsive smoke,
desktop-signed happy path, and verifier live smoke.

## Manual QA

Complete `docs/human-qa-checklist.md`, then summarize:

- [ ] Admin producer workflow passed.
- [ ] Producer workflow passed.
- [ ] Verifier workflow passed.
- [ ] Cross-role end-to-end workflow passed.
- [ ] Negative and edge cases passed.

Reviewer notes:

```txt

```

## Fresh-Machine Setup

Run `docs/getting-started.md` from a clean checkout or a fresh local machine.

- [ ] Dependencies installed from scratch.
- [ ] Local infra started.
- [ ] Migrations applied.
- [ ] Seeded evaluation credentials created.
- [ ] Desktop app launched.
- [ ] Verifier app launched.
- [ ] `pnpm smoke:happy-path` passed.
- [ ] `pnpm eval:smoke` passed against the running verifier.

Reviewer notes:

```txt

```

## Final Eval Account Pass

- [ ] `admin-producer-eval@example.com` can sign in to the desktop app and see admin controls.
- [ ] `producer-eval@example.com` can sign in to the desktop app.
- [ ] Producer can submit browser-hashed and externally pasted SHA-256 attestations.
- [ ] Producer can grant and revoke verifier access.
- [ ] `verifier-eval@example.com` can sign in to the verifier web client.
- [ ] Verifier can perform match and no-match lookups.
- [ ] Public verification pages open and show JSON/PDF actions.

Reviewer notes:

```txt

```

## Defects And Acceptance

Blocking defects:

```txt

```

Accepted non-blocking defects or limitations:

```txt

```

Final sign-off:

- [ ] Human QA checklist has a named reviewer and date.
- [ ] Blocking defects are fixed or explicitly accepted.
- [ ] Release owner approves tagging the first desktop-first evaluatable build.
