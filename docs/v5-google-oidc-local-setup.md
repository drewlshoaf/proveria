# V5 Google OIDC Local Setup

Use this guide to wire Google into the local Proveria stack as the second OIDC
provider. This enables Google sign-in and Profile connection through the same
generic OIDC driver used by Microsoft Entra ID/Azure AD. Google Drive file
selection/import is a separate follow-on step.

## Prerequisites

- A local Proveria checkout with dependencies installed.
- Local infra, API, worker, desktop, and verifier running from
  `docs/getting-started.md`.
- A Google account with access to create an OAuth client in Google Cloud.

## OAuth Client

In Google Cloud Console:

1. Open **APIs & Services** > **OAuth consent screen** and configure the local
   testing app if it does not already exist.
2. Open **APIs & Services** > **Credentials**.
3. Create an **OAuth client ID**.
4. Choose **Web application** as the application type.
5. Add this authorized redirect URI:

   ```text
   http://127.0.0.1:3001/auth/oidc/google/callback
   ```

6. Copy the client ID and client secret.
7. Add local tester accounts to the OAuth consent screen if the app is in test
   publishing status.

Google sign-in only needs `openid`, `email`, and `profile`. Do not add Drive
scopes for this provider-only QA pass.

## Environment

Set these values for the API process before starting or restarting it:

```sh
PUBLIC_API_BASE_URL=http://127.0.0.1:3001
PROVERIA_OIDC_GOOGLE_ENABLED=true
PROVERIA_OIDC_GOOGLE_CLIENT_ID=<google-oauth-client-id>
PROVERIA_OIDC_GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
PROVERIA_OIDC_GOOGLE_CLIENT_SECRET_REF=local-google-client-secret
PROVERIA_OIDC_GOOGLE_SCOPES=openid,email,profile
PROVERIA_OIDC_GOOGLE_ALLOWED_DOMAINS=
```

`PROVERIA_OIDC_GOOGLE_CLIENT_SECRET_REF` is only a display/reference label. Do
not commit the plaintext client secret. Set `PROVERIA_OIDC_GOOGLE_ALLOWED_DOMAINS`
to a comma-separated allowlist, such as `example.com`, when you want to restrict
local sign-in to specific email domains.

Run migrations if this checkout has not already applied the OIDC tables:

```sh
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria pnpm --filter @proveria/db db:migrate
```

Then restart the API and desktop app. The desktop sign-in screen should show
`Continue with Google`.

## QA Path

1. Confirm the API is healthy at `http://127.0.0.1:3001/healthz`.
2. Confirm `GET http://127.0.0.1:3001/auth/oidc/providers` includes the
   `google` provider.
3. From the desktop sign-in screen, click `Continue with Google`.
4. Complete Google sign-in in the auth window.
5. Confirm the desktop app signs in and mints a trusted device session.
6. Open Profile and confirm **Sign-in methods** lists Google.
7. Sign in with a seeded password account and use Profile to connect Google as
   an additional sign-in method.
8. Confirm disconnect is blocked if it would remove the user's last active
   sign-in method.

## Troubleshooting

- Provider button missing: verify the API process has the Google environment
  variables and was restarted.
- `oidc_token_exchange_failed`: check the redirect URI, client id, client
  secret, OAuth client type, and OAuth consent screen tester list.
- `oidc_invalid_issuer`: Google ID tokens should use
  `https://accounts.google.com` as issuer.
- `oidc_invalid_audience`: check `PROVERIA_OIDC_GOOGLE_CLIENT_ID`.
- `oidc_invalid_nonce`: restart the sign-in flow from the desktop button.
- Desktop does not finish sign-in: confirm `PUBLIC_API_BASE_URL` matches the
  local API origin and the registered redirect URI exactly.
