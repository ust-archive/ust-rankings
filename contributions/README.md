# Contribution module

Issues #43–#47 introduce accounts, complete Review Bases and Context,
optimistic immutable Review editing, per-Revision attribution, author
withdrawal, and private-identity Course/Instructor signals. Application routes cross
`lib/contributions/accounts.ts`, `lib/contributions/reviews.ts`, and
`lib/contributions/signals.ts`; PostgreSQL transactions and objects remain in the
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
uniqueness records used by the first text-only path. `0003_signals.sql` adds
separate portable relational keys for Course and Instructor Thumbs Votes and
Emoji Reactions, aggregate-read indexes, the fixed Emoji palette, and durable
Instructor merge redirects. `0004_complete_review_associations.sql` expands the
same Review seam to optional Course and Instructor Bases, Term and Section
Context snapshots, exact null-aware active-tuple uniqueness, Context lookup
indexes, and an explicit needs-resolution state for uncertain Instructor
identity corrections. `0005_review_lifecycle.sql` adds Attributed and
Identity-hidden Revision snapshots, expected-current optimistic editing,
transactional reassociation, active-tuple collision protection, and author-only
withdrawal. Apply every migration in order; historical Revision associations
are never revalidated or guessed when current source data changes.

Identity-hidden public reads emit no captured Public Display Name and use `UST
Rankings contributor` plus the Review permalink for CC BY 4.0 credit. The
internal Review-to-User link remains available only through controlled
contribution storage. Withdrawal removes the current Review from public reads
without deleting immutable Revisions. It does not recall CC BY 4.0 rights from
copies already obtained.

Signal reads return only aggregate counts plus the requesting User's own current
states. Pages are dynamic and never put session-specific state or participant
identities in shared cache entries. Mutations send desired state, re-check active
User status in the same PostgreSQL statement, and validate targets against the
ranking module. Course Offerings, Classes, and Reviews are not accepted targets.

When an approved Instructor registry correction merges UUIDs, run the idempotent
deployment-controlled operation after applying migrations:

```sh
bun run contributions:merge-instructor-signals <retired-uuid> <survivor-uuid>
```

It moves signals to the survivor, keeps the most recently updated conflicting
Thumbs state, deduplicates same-code Emoji Reactions, and records a redirect so a
concurrent stale write cannot recreate rows on the retired UUID. Instructor
writes share one redirect-graph lock while merges take it exclusively, so stale
writes remain safe across chained merges. Reversed/cyclic merge requests fail
without printing success. Instructor splits require no signal operation and
retain signals on the original UUID.

## Production gates outside source control

Production remains blocked until the owner supplies and verifies the production
Entra registrations/secrets and exact origins, the pooled Singapore PostgreSQL
connection, human-approved privacy/community/Review and CC BY 4.0 licensing
text, approved Privacy Contact role/title, correspondence address, and email,
and preview/production OIDC/PostgreSQL Review lifecycle evidence. Local copy
and tests are implementation prerequisites only and do not claim legal approval.
Never commit those values. Preview evidence must also verify Vercel Bun Server Actions preserve same-origin
checks; complete Review Basis/Context association validation uses accepted
Rankings and Schedule generations; dual-Basis Reviews appear once on each
applicable detail page; public Course and Instructor pages remain dynamic across
separate signed-in and signed-out requests; signal mutations never alter ranking results
or generation cache identity; and the private database never exposes
voter/reactor identities through rendered output or shared responses.
