# V5 Public Developer Language

Use this wording across public API, CLI, SDK, webhook, receipt, and verification
docs.

## Workspace Slug

Use `workspace slug` in user-facing docs.

Public API compatibility paths still use `/v1/tenants/{slug}`. Explain this as:

> Public v1 keeps `/tenants/{slug}` paths for compatibility. In V5, `{slug}` is
> the workspace slug.

Avoid introducing `tenant` in new explanatory prose unless describing the
compatibility path itself.

## Receipt

Use `receipt` for the attestation-level record that proves the attestation was
confirmed.

Preferred wording:

- `attestation receipt`
- `public receipt page`
- `receipt PDF`
- `receipt JSON`
- `receipt bundle`

Avoid:

- `public option`
- `receipt attempt`
- `Proveria as attestor`

The receipt refers to the attestation record, not to a verifier lookup attempt.

## Verification Result

Use `verification result` for a verifier lookup outcome.

Preferred wording:

- `private verifier lookup`
- `public verification result`
- `result package`
- `result PDF`
- `result JSON`
- `Content match`
- `Whole-file match`
- `No match`

Avoid raw implementation terms in user-facing copy:

- `shingle`
- `leaf`
- `proof path`
- `tenant`

Those terms can still appear inside technical JSON or protocol documentation.

## Content Proof

Use `text content proof` when describing passage-level verification.

Preferred wording:

- `text content proof hashes`
- `Native PDF text`
- `OCR text`
- `Matched content proof hash`

Avoid `shingle` in public UI and general developer docs unless the section is
explicitly about protocol internals.

## Attestors And Signatures

Do not describe Proveria as an attestor.

Preferred wording:

- `producer-submitted attestation`
- `device signature`
- `receipt signature`
- `signature check`
- `signed result package`

Avoid:

- `Proveria attested`
- `Proveria is the attestor`

Proveria can sign receipts and result packages as the service issuing the
package. The producer remains the party submitting the attestation.
