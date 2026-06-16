# V5 Entra-First OIDC And Google Drive Intake Design

This design adds a generic OIDC identity layer, with Microsoft Entra ID/Azure
AD as the first concrete provider and Google as the next provider for Drive
intake. It should not make Proveria Entra-only or Google-only. The same driver
should support Microsoft Entra ID/Azure AD, Okta, Google, and compatible OIDC
providers through provider configuration.

This does not change Proveria's proof boundary: hashes are still generated
locally where possible, files are not retained by Proveria unless a future
explicit storage feature is introduced, and workspace access remains controlled
by Proveria roles.

## Recommendation

Implement this in two phases:

1. Generic OIDC sign-in and account linking, with Microsoft Entra ID/Azure AD
   wired as the first provider.
2. Google OIDC sign-in and account linking through the same provider driver.
3. Google Drive file selection for desktop-side download, hashing, and
   attestation.

Do not start with hosted Drive ingestion. The first version should keep the
privacy model simple: Google grants Drive access to the user, the desktop
downloads the selected file bytes to the local app process, Proveria hashes
locally, and only proof metadata is submitted.

## Goals

- Let users sign in with OIDC providers such as Microsoft Entra, Okta, and
  Google instead of password-only credentials.
- Let signed-in users link or unlink external OIDC identities from Profile.
- Let producers choose Google Drive files from New Attestation.
- Preserve the existing workspace membership and device-signing model.
- Record Drive source metadata on the attestation attempt without treating
  Google as an attestor.
- Show clear in-product language about what is read, hashed, stored, and never
  stored.
- Emit audit events for external identity connection, disconnection, OIDC
  sign-in, Drive file selection, and Drive-sourced attestation submission.

## Non-Goals

- No Google Workspace domain-wide delegation in the first implementation.
- No service-account crawling of Drive.
- No background synchronization of Drive folders.
- No Proveria-hosted file retention.
- No Drive-native sharing or verifier access management through Google.
- No automatic workspace provisioning from Google groups. That belongs with the
  later enterprise SSO/SCIM work.
- No admin UI for arbitrary enterprise OIDC provider setup in the first pass.
  Entra can be configured through environment/configuration first and later
  exposed in organization admin settings.
- No SAML in this V5 implementation. SAML belongs with the later enterprise SSO
  track.

## Product Model

External OIDC identity should be treated as an authentication method. Google
also acts as an optional Drive file source, not as the source of truth for
organization membership.

- Proveria user: canonical account record.
- Proveria organization/workspace membership: canonical authorization model.
- OIDC provider: configured external identity provider with issuer, client,
  scopes, and claim mapping.
- External identity: linked provider id, provider subject, verified email, and
  profile claims. The stable lookup key is provider id plus subject.
- Google identity: an external identity from the Google OIDC provider. It may
  also authorize Google Drive file selection.
- Desktop device key: still required for producer/admin desktop operations.

For desktop sign-in, OIDC replaces the password check but should still mint a
local desktop device key after the user is authenticated and authorized.

Recommended provider configuration:

- provider slug, such as `entra-acme`, `okta-acme`, or `google`;
- provider display name;
- provider type: `oidc`;
- issuer URL and discovery document URL;
- client id and encrypted client secret reference;
- scopes;
- redirect URI;
- claim mapping for subject, email, email verified, name, and avatar;
- optional allowed email domains or hosted-domain restrictions;
- enabled/disabled flag;
- signup and account-linking policy.

Initial Entra environment configuration:

- `PROVERIA_OIDC_ENTRA_ENABLED=true`;
- `PROVERIA_OIDC_ENTRA_TENANT_ID`, defaulting to `common` for local testing;
- `PROVERIA_OIDC_ENTRA_CLIENT_ID`;
- `PROVERIA_OIDC_ENTRA_CLIENT_SECRET`, optional for public-client test apps and
  required for confidential-client app registrations;
- `PROVERIA_OIDC_ENTRA_CLIENT_SECRET_REF`, a reference name only, not the
  plaintext secret;
- `PROVERIA_OIDC_ENTRA_SCOPES`, defaulting to `openid,email,profile`;
- `PROVERIA_OIDC_ENTRA_ALLOWED_DOMAINS`, optional comma-separated domains;
- `PUBLIC_API_BASE_URL`, used to build the OIDC callback URL.

For a concrete local setup and QA path, see
`docs/v5-entra-oidc-local-setup.md`.

Initial Google environment configuration:

- `PROVERIA_OIDC_GOOGLE_ENABLED=true`;
- `PROVERIA_OIDC_GOOGLE_CLIENT_ID`;
- `PROVERIA_OIDC_GOOGLE_CLIENT_SECRET`, required for the local web OAuth
  client;
- `PROVERIA_OIDC_GOOGLE_CLIENT_SECRET_REF`, a reference name only, not the
  plaintext secret;
- `PROVERIA_OIDC_GOOGLE_SCOPES`, defaulting to `openid,email,profile`;
- `PROVERIA_OIDC_GOOGLE_ALLOWED_DOMAINS`, optional comma-separated domains;
- `PUBLIC_API_BASE_URL`, used to build the OIDC callback URL.

For a concrete local setup and QA path, see
`docs/v5-google-oidc-local-setup.md`.

## Authentication Flow

### Sign In With OIDC

1. User clicks a provider button such as `Continue with Google`,
   `Continue with Okta`, or `Continue with Microsoft`.
2. Desktop opens an auth window for OAuth/OIDC.
3. API validates the provider issuer, client, authorization code exchange, ID
   token signature, nonce, audience, expiry, and subject.
4. API finds or creates the Proveria user according to policy.
5. API resolves organization/workspace access.
6. Desktop mints or refreshes the local trusted device session.

Recommended account creation policy:

- If the verified OIDC email matches an invited user, allow registration and
  invitation acceptance.
- If the verified OIDC email matches an existing password user, link the
  external identity after confirmation.
- If no invitation or existing user exists, allow personal/evaluation workspace
  creation only if open signup is enabled.
- For enterprise domains, defer automatic domain-based provisioning until the
  SSO/SCIM track.

### Account Linking

Profile should support:

- connect an external identity provider;
- show connected provider, provider subject, and email;
- disconnect external identity;
- block disconnect if it would leave the user with no viable sign-in method.

Provider-specific UI can say `Continue with Microsoft` or `Connect Google`
where that helps the user. The underlying model and API should still be
provider-neutral.

## Drive Intake Flow

New Attestation should offer:

- Local file upload.
- External SHA-256.
- Google Drive file.

Recommended Google Drive flow:

1. User clicks `Choose from Google Drive`.
2. Desktop opens Google Picker or browser OAuth flow.
3. User selects one or more files.
4. Desktop downloads file bytes locally using the user's Google access token.
5. Desktop computes whole-file SHA-256 locally.
6. Desktop attempts content proof extraction locally for supported files.
7. Desktop submits the same attestation payload used for local files, with
   additional Drive source metadata.

The selected Drive file should appear in the same multi-file submission list as
local files. Its row should show source, filename, size where available, hash,
content proof status, submission progress, and final attestation link.

## Drive Metadata

Store source metadata that helps the user and auditors understand provenance,
without making Drive metadata part of the cryptographic claim unless explicitly
committed in the manifest.

Recommended metadata:

- source provider: `google_drive`;
- Drive file id;
- Drive file name at selection time;
- MIME type;
- size if provided by Drive;
- modified time if provided by Drive;
- selected by user id;
- selected at timestamp;
- Google account email used for selection.

Do not store:

- OAuth access tokens in audit logs;
- Drive file bytes;
- Drive folder contents;
- broad Drive listings beyond selected file metadata.

## Security And Privacy

Use least-privilege provider scopes:

- For Google Drive, prefer `drive.file` for files the user selects or creates through the app.
- For Google Drive, avoid full `drive.readonly` unless Picker/download requirements force it.
- Keep OIDC and Drive refresh tokens encrypted at rest if long-lived Drive
  access is needed.
- Prefer short-lived access tokens and reauthorization for the first version.

Desktop should display direct privacy language:

> Proveria downloads the selected Drive file to this desktop to compute hashes.
> File bytes are not uploaded or stored by Proveria. The attestation records the
> hash, proof metadata, and Drive source reference.

## API Shape

Add or reserve endpoints along these lines:

- `GET /auth/oidc/:provider/start`
- `GET /auth/oidc/:provider/callback`
- `POST /me/external-identities/:provider/connect`
- `POST /me/external-identities/:identityId/disconnect`
- `POST /tenants/:slug/google-drive/selections`

The Drive selection endpoint should record source metadata and return a
selection id if the desktop needs a durable local-to-server reference. The
actual attestation creation endpoint should remain the same shape as local file
attestation, with optional source metadata attached to the attempt.

## Audit Events

Add audit actions:

- `oidc.sign_in_succeeded`
- `oidc.sign_in_failed`
- `external_identity.connected`
- `external_identity.disconnected`
- `google_drive.file_selected`
- `attestation.source_google_drive_submitted`

Events should include user, workspace, project, attestation where applicable,
provider id/name, Drive file id/name/MIME metadata, and never include access
tokens or file bytes.

## QA Scenarios

- Sign in with Google as an invited producer.
- Sign in with Microsoft Entra as an invited producer.
- Link Microsoft Entra to an existing password account.
- Link Google to an existing password account when the Google provider is added.
- Repeat sign-in and linking with a second generic OIDC fixture when available.
- Confirm provider plus subject, not email alone, is the stable identity match.
- Disconnect an external identity while password sign-in remains available.
- Confirm disconnect is blocked when it would remove the last sign-in method.
- Choose a Drive PDF and submit an attestation.
- Confirm browser/desktop-side hash matches a separately downloaded copy.
- Confirm content proof works for native-text Drive PDFs.
- Confirm unsupported Drive formats fall back to whole-file coverage.
- Confirm Drive-sourced rows clear after successful submission.
- Confirm audit events appear for account connection, file selection, and
  attestation submission.

## Open Decisions

- Whether Google Picker can satisfy least-privilege `drive.file` while still
  enabling reliable desktop download.
- Whether OIDC and Drive tokens should be desktop-only, server-side, or split by
  flow.
- Whether organization admins can disable specific OIDC providers, Google
  sign-in, or Drive import.
- Whether Drive source metadata should be committed into the manifest or remain
  descriptive receipt metadata.
- Whether Drive folder/batch intake belongs in V5 or a later integration
  release.
