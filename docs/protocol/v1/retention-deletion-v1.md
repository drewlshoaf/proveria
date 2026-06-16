# Proveria Retention and Deletion V1

> Cross-reference: [docs/v1](../../v1) §22.3 (retention/deletion), §25.1 (backup/DR), §19 (audit logging).

## Status

Draft

## Owner

Product / Architecture

## Reviewers

Engineering
Legal input later if needed

## Purpose

Define V1 retention, cleanup, deletion, anonymization, and recovery boundaries for Proveria evidence artifacts, failed attempts, canceled attempts, local drafts, user data, and audit records.

This spec gates Milestone 15.

## Goals

- Define retention classes.
- Define what is never casually deleted.
- Define cleanup policy for failed/canceled attempts.
- Define local draft recovery boundary.
- Define user deletion/anonymization behavior.
- Define audit retention posture.
- Define object storage lifecycle expectations.

## Non-Goals

- Full enterprise custom retention policies.
- Legal hold workflow beyond basic lock flag.
- Multi-region DR.
- Customer-specific data processing agreements.

## Artifact Classes

| Class                            | Examples                                          |
| -------------------------------- | ------------------------------------------------- |
| Confirmed canonical artifacts    | manifests, leaves, receipts, proof packages       |
| Pre-confirmation failed attempts | failed manifests, validation results              |
| Canceled attempts                | canceled pre-confirmation submissions             |
| Local drafts                     | desktop-local encrypted drafts                    |
| User personal data               | name, email, profile metadata                     |
| Audit records                    | audit event rows, hash-chain entries              |
| Support metadata                 | job status, object references, internal diagnostics |

## Retention Defaults

| Artifact class                     | V1 default                                                               |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Confirmed canonical artifacts      | retained per plan policy; no UI hard delete                              |
| Failed pre-confirmation attempts   | 90 days, then cleanup-eligible                                           |
| Canceled pre-confirmation attempts | 90 days, then cleanup-eligible                                           |
| Local drafts                       | user-controlled local deletion                                           |
| User personal data                 | deactivation, soft deletion, anonymization where lawful                  |
| Audit rows                         | retained with minimized personal payloads                                |

## Cleanup Locks

Cleanup blocked by:

- admin lock
- export pending
- legal hold
- active support investigation
- confirmed canonical status

## Confirmed Artifacts

Confirmed artifacts are immutable.

No ordinary UI deletion in V1.

Deletion can only be considered under explicit administrative/legal process defined outside normal product UI.

## Failed and Canceled Attempts

Default retention:

- 90 days

After retention window:

- object payloads eligible for cleanup
- audit event remains
- stable internal references remain
- sensitive-adjacent metadata minimized where possible

## Local Drafts

Stored locally.

Encrypted using OS credential vault/keychain.

Boundary:

- unrecoverable if local encryption key is lost
- not backed up by Proveria
- can be deleted freely by producer

## User Deletion and Anonymization

Supported V1 actions:

- deactivate account
- soft-delete user profile
- anonymize display fields where lawful/appropriate
- preserve stable internal IDs for evidence integrity

Audit records should avoid storing personal data directly where possible.

## Audit Records

Audit rows are append-only.

Enterprise hash-chain records are retained.

Personal data in audit payloads should be minimized.

## Object Storage Lifecycle

Required lifecycle policies:

- failed attempt cleanup
- canceled attempt cleanup
- noncanonical temporary object cleanup
- canonical artifact protection

## Backup / DR Alignment

Retention must align with:

- RDS PITR
- S3 versioning
- lifecycle policies
- documented restore procedure

## Open Questions

- Exact plan-level retention language for Team/Enterprise?
- Manual legal/admin deletion process?
- Whether Free public attestations can ever be withdrawn from public view while retained internally?

## Approval Checklist

- [ ] Product / Architecture review complete
- [ ] Engineering review complete
- [ ] Legal review if needed
- [ ] Lifecycle policy agreed
- [ ] Approved for Milestone 15
