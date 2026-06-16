# Proveria Desktop Trust V1

> Cross-reference: [docs/v1](../../v1) §9 (desktop app), §15 (signing), §26.1.1 (forced version policy).

## Status

Draft

## Owner

Engineering

## Reviewers

Product / Architecture

## Purpose

Define desktop device pairing, local identity, signing keys, profile scoping, OS credential storage, version enforcement, and submission trust rules for Proveria V1.

This spec gates Milestones 2 and 15.

## Goals

- Define browser-mediated device pairing.
- Define per-profile desktop identity.
- Define Ed25519 key generation and storage.
- Define device revocation.
- Define local draft encryption boundary.
- Define forced version policy.
- Define offline TTL behavior.

## Non-Goals

- Define customer-managed signing.
- Define full desktop auto-update.
- Define storage connectors.
- Define native worker process architecture.

## Device Pairing Flow

1. Desktop app starts pairing.
2. Desktop app shows pairing code or opens browser.
3. User authenticates in portal.
4. User selects tenant.
5. User approves device.
6. Desktop generates or registers Ed25519 public key.
7. Server creates device record.
8. Desktop stores credential in OS credential vault.
9. Desktop receives tenant-scoped pairing credential.

## Identity Scope

All desktop-local trust material is scoped by:

```txt
tenant_id + user_id + device_id + profile_id
```

Applies to:

- signing keys
- local drafts
- local cache
- keychain entries
- profile selection
- audit events
- revocation behavior

## Signing Algorithm

V1 device signing:

- Ed25519

Key storage:

- OS credential vault/keychain

Open decisions:

- Generate key before or after server pairing approval?
- How to rotate key?
- How to represent public key in server record?

## Device Records

Server records:

- device ID
- user ID
- tenant ID
- profile ID
- public key
- app version
- platform
- paired timestamp
- revoked timestamp
- last seen timestamp
- current protocol compatibility

## Revocation

Tenant Admin may revoke device/profile.

Revocation blocks:

- future submissions
- future pairing-token use

Revocation does not delete:

- confirmed attestations
- historical audit records
- local drafts automatically

## Local Draft Encryption

Drafts are encrypted locally.

Recovery boundary:

- drafts are unrecoverable if local encryption key is lost

User-facing warning required before substantial draft work.

## Desktop Version Enforcement

Desktop checks API for version policy.

Policy includes:

- minimum supported version
- recommended version
- blocked versions
- protocol compatibility range
- fetched timestamp
- expiration timestamp
- upgrade URL
- release notes URL

Policy response must be signed by Proveria.

## Offline TTL

V1 default:

- 7 days

Behavior:

| Scenario                          | Behavior                                      |
| --------------------------------- | --------------------------------------------- |
| Online and allowed                | Normal                                        |
| Online and below minimum          | Block submission                              |
| Online and blocked                | Block submission                              |
| Offline and cached policy valid   | Allow submission if current version allowed   |
| Offline and cached policy expired | Allow draft view/export; block submission     |
| Blocked version                   | Drafts readable/exportable; submission blocked |

## Audit Events

Audit:

- pairing started
- pairing completed
- device revoked
- key rotated
- blocked version attempted submission
- submission signed
- submission rejected due to trust policy

## Test Vectors

Required:

- sample device signature payload
- expected Ed25519 signature verification result
- version policy payload
- signed version policy verification result

## Approval Checklist

- [ ] Engineering review complete
- [ ] Product / Architecture review complete
- [ ] Test vectors committed
- [ ] Approved for Milestones 2 and 15
