# Contribution accounts

Issue #43 introduces the account slice of the contribution module. Application
routes cross `lib/contributions/accounts.ts`; PostgreSQL details remain in the
adapter and forward migrations under `contributions/migrations`.

## Local setup

1. Create an empty disposable PostgreSQL database.
2. Set `CONTRIBUTIONS_POSTGRES_URL` and run `bun run contributions:migrate`.
3. Generate `AUTH_SECRET` with Auth.js tooling and configure separate Entra Web
   client IDs/secrets for the Connect and staff providers listed in
   `.env.example`.
4. Register exact callbacks for the deployment origin:
   - `/api/auth/callback/hkust-connect`
   - `/api/auth/callback/hkust-staff`
5. After approved policy copy and Privacy Contact details are published at
   `/privacy`, set `PRIVACY_POLICY_VERSION` and `COMMUNITY_RULES_VERSION` to the
   matching human-approved versions. Onboarding intentionally remains disabled
   while either is blank.

The issuers are pinned in source to the public tenant metadata for
`connect.ust.hk` and `ust.hk`. The providers request only `openid profile email`.
Provider access, refresh, and ID tokens are discarded at the Auth.js callback;
the encrypted HttpOnly JWT retains only internal User lookup and minimal UI
state. No Auth.js database adapter or custom session lifetime is configured.

Set `TEST_CONTRIBUTIONS_POSTGRES_URL` to an isolated disposable database to run
the PostgreSQL contract test. The test creates and drops its own schema.

## Production gates outside source control

Production remains blocked until the owner supplies and verifies the production
Entra registrations/secrets and exact origins, the pooled Singapore PostgreSQL
connection, approved policy versions/text and Privacy Contact details, and
preview/production OIDC callback evidence. Never commit those values.
