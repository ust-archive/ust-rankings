# Contribution module

Issues #43–#50 introduce accounts, complete Review Bases and Context,
optimistic immutable Review editing, per-Revision attribution, author
withdrawal, private-identity Course/Instructor signals, raster Image
Attachments, mixed-format Document Attachments, authenticated Review reports,
and deployment-controlled moderation. Application routes cross
`lib/contributions/accounts.ts`, `lib/contributions/reviews.ts`,
`lib/contributions/signals.ts`, `lib/contributions/moderation.ts`, and
`lib/attachments/attachments.ts`; PostgreSQL transactions, Space keys, and
objects remain in the adapters and forward migrations under
`contributions/migrations`.

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
   Set `PRIVACY_CONTACT_EMAIL` (and optional title/address) so `/privacy`, the
   footer, and FAQ share one correspondence channel.
6. Rights requests are email-based. Record them with
   `bun run contributions:moderate rights-request <user-uuid> <operator> <access|correction|withdrawal|closure|deletion>`,
   then `withdraw-review` or `close-account` as appropriate. There is no
   self-service closure UI.

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

`0006_raster_attachments.sql` adds Upload Intents, Stored Files, and immutable
Attachments. `0007_document_attachments.sql` expands accepted document MIME
types and adds operator byte-removal columns. `0008_moderation.sql` adds
private Review reports and minimal Moderation Cases for reports, operator
actions, and justified identity lookups. The attachment module owns
reservation, opaque object keys, validation, association, signed delivery,
cleanup, removal, and S3 operations. Configure the dedicated private Space
origin (not CDN) variables in `.env.example` and exact-origin CORS allowing
`PUT` and `HEAD` only. Set Spaces to abort incomplete multipart uploads after
one day as a lifecycle backstop; application cleanup is the primary 24-hour
path. Daily `/api/attachments/cleanup` uses `CRON_SECRET` and releases quota
only after the object is confirmed gone. Set `ATTACHMENTS_UPLOADS_DISABLED=1`
to reject new uploads without disabling Review text or existing downloads.
Accepted files are not malware-scanned; UI copy must not claim otherwise.
Attachments receive only a non-exclusive site license and are not automatically
CC BY 4.0.

To withdraw a Review, suppress abusive attribution, remove Stored File bytes
while preserving Attachment Tombstones, suspend a User, or inspect identity,
use the deployment-controlled operator tool. It records a Moderation Case in
the same transaction. There is no website Moderator or Administrator role.

```sh
bun run contributions:moderate withdraw-review <review-uuid> <operator> <reason>
bun run contributions:moderate suppress-attribution <review-uuid> <operator> <reason>
bun run contributions:moderate remove-stored-file <stored-file-uuid> <operator> <reason>
bun run contributions:moderate suspend-user <user-uuid> <operator> <reason>
bun run contributions:moderate lookup-identity <review-uuid> <operator> <lookup-reason>
```

`lookup-reason` must be `report`, `security-incident`, `rights-request`, or
`legal-request`. A `report` lookup requires an existing report on that Review.
After `remove-stored-file`, call authenticated `GET /api/attachments/cleanup`
(or wait for the daily cron) so bytes are deleted, the Tombstone remains, and
quota is released. Notify affected Users through the published contact when
practical; reconsideration uses the same contact. There is no public
moderation log.

Identity-hidden public reads emit no captured Public Display Name and use `UST
Rankings contributor` plus the stable `/reviews/{review-id}` permalink for CC BY
4.0 credit. The permalink is based only on immutable Review identity, resolves
only the active current Review Revision across reassociation, and returns no
Review after withdrawal. The internal Review-to-User link remains available only
through controlled contribution storage. Withdrawal removes the current Review
from public reads without deleting immutable Revisions. It does not recall CC BY
4.0 rights from copies already obtained.

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
