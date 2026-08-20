# Contribution module

Issues #43 and #44 introduce accounts and attributed Course Reviews. Application
routes cross `lib/contributions/accounts.ts` and `lib/contributions/reviews.ts`;
PostgreSQL transactions and objects remain in the adapter and forward migrations
under `contributions/migrations`.

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
   `/privacy`, set `PRIVACY_POLICY_VERSION`, `COMMUNITY_RULES_VERSION`, and
   `REVIEW_POLICY_VERSION` to the matching human-approved versions. Onboarding
   intentionally remains disabled while either account-policy version is blank;
   Review publication remains disabled while the Review version is blank.

The issuers are pinned in source to the public tenant metadata for
`connect.ust.hk` and `ust.hk`. The providers request only `openid profile email`.
Provider access, refresh, and ID tokens are discarded at the Auth.js callback;
the encrypted HttpOnly JWT retains only internal User lookup and minimal UI
state. No Auth.js database adapter or custom session lifetime is configured.

Set `TEST_CONTRIBUTIONS_POSTGRES_URL` to an isolated disposable database to run
the PostgreSQL contract tests. They create and drop their own schemas. Apply
migrations before serving the application; `0002_course_reviews.sql` adds the
stable Review, immutable Review Revision, current pointer, Course Basis,
captured attribution, policy version, publication state, and active-tuple
uniqueness records used by the first text-only path.

## Production gates outside source control

Production remains blocked until the owner supplies and verifies the production
Entra registrations/secrets and exact origins, the pooled Singapore PostgreSQL
connection, approved policy and Review-term versions/text and Privacy Contact
details, and preview/production OIDC/PostgreSQL Review publication evidence.
Never commit those values. Preview evidence must also verify Vercel Bun Server
Actions preserve same-origin checks and that public Course pages remain dynamic
across separate signed-in and signed-out requests.
