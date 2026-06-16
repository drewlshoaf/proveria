# V5 Microsoft Entra OIDC Local Setup

Use this guide to wire Microsoft Entra ID/Azure AD into the local Proveria
stack as the first concrete OIDC provider. This is optional for normal seeded
evaluation, but required for the V5 Entra sign-in and Profile connection QA.

## Prerequisites

- A local Proveria checkout with dependencies installed.
- Local infra, API, worker, desktop, and verifier running from
  `docs/getting-started.md`.
- A Microsoft account or Entra tenant that allows app registrations.

A paid Entra tier is not expected for local OIDC sign-in testing. Tenant policy
can still restrict who may create app registrations or consent to sign-in.

## App Registration

In the Microsoft Entra admin center or Azure portal:

1. Open **Microsoft Entra ID** > **App registrations**.
2. Create a new registration named `Proveria Local Dev`.
3. Choose the supported account type:
   - for a company tenant QA pass, use single tenant and set the tenant id in
     Proveria;
   - for broader local testing, use the option that includes any directory and
     personal Microsoft accounts, then use `common` as the tenant id.
4. Add a **Web** redirect URI:

   ```text
   http://127.0.0.1:3001/auth/oidc/entra/callback
   ```

5. Copy the **Application (client) ID**.
6. Copy the **Directory (tenant) ID**, unless you intentionally use `common`.
7. If the app registration is confidential, create a client secret under
   **Certificates & secrets** and copy the value immediately.
8. Keep the default OpenID Connect scopes. Proveria needs `openid`, `email`,
   and `profile` for sign-in. Microsoft Graph permissions are not required for
   this local sign-in path.

## Environment

Set these values for the API process before starting or restarting it:

```sh
PUBLIC_API_BASE_URL=http://127.0.0.1:3001
PROVERIA_OIDC_ENTRA_ENABLED=true
PROVERIA_OIDC_ENTRA_TENANT_ID=<tenant-id-or-common>
PROVERIA_OIDC_ENTRA_CLIENT_ID=<application-client-id>
PROVERIA_OIDC_ENTRA_CLIENT_SECRET=<client-secret-if-confidential-app>
PROVERIA_OIDC_ENTRA_CLIENT_SECRET_REF=local-entra-client-secret
PROVERIA_OIDC_ENTRA_SCOPES=openid,email,profile
PROVERIA_OIDC_ENTRA_ALLOWED_DOMAINS=
```

`PROVERIA_OIDC_ENTRA_CLIENT_SECRET_REF` is only a display/reference label. Do
not commit the plaintext client secret. Set `PROVERIA_OIDC_ENTRA_ALLOWED_DOMAINS`
to a comma-separated allowlist, such as `example.com`, when you want to restrict
local sign-in to specific email domains.

Run migrations if this checkout has not already applied the OIDC tables:

```sh
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria pnpm --filter @proveria/db db:migrate
```

Then restart the API and desktop app. The desktop sign-in screen should show
`Continue with Microsoft Entra ID`.

## QA Path

1. Confirm the API is healthy at `http://127.0.0.1:3001/healthz`.
2. Confirm `GET http://127.0.0.1:3001/auth/oidc/providers` includes the
   `entra` provider.
3. From the desktop sign-in screen, click `Continue with Microsoft Entra ID`.
4. Complete Microsoft sign-in in the auth window.
5. Confirm the desktop app signs in and mints a trusted device session.
6. Open Profile and confirm **Sign-in methods** lists Microsoft Entra ID.
7. Sign in with a seeded password account and use Profile to connect Microsoft
   Entra ID as an additional sign-in method.
8. Confirm disconnect is blocked if it would remove the user's last active
   sign-in method.
9. Optional: set `PROVERIA_OIDC_ENTRA_ALLOWED_DOMAINS` to a domain that does
   not match the Microsoft account, restart the API, and confirm sign-in is
   rejected.

## Troubleshooting

- Provider button missing: verify the API process has the Entra environment
  variables and was restarted.
- `oidc_token_exchange_failed`: check the redirect URI, client id, client
  secret, and app registration platform type.
- `oidc_invalid_issuer`: check `PROVERIA_OIDC_ENTRA_TENANT_ID`; single-tenant
  apps should use the directory tenant id, not `common`.
- `oidc_invalid_audience`: check `PROVERIA_OIDC_ENTRA_CLIENT_ID`.
- `oidc_invalid_nonce`: restart the sign-in flow from the desktop button.
- Desktop does not finish sign-in: confirm `PUBLIC_API_BASE_URL` matches the
  local API origin and the registered redirect URI exactly.
