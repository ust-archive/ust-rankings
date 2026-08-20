# Runtime ranking seed

The application ships one complete, validated ranking generation under
`seed/<Hugging Face commit SHA>/`. A generation contains exactly the five v0
Parquet relations plus its application-owned `manifest.json`.

The manifest pins the immutable source commit and declares every Parquet file's
SHA-256 and byte size. It also assigns permanent application UUIDs to the
Canonical Instructor Names in that generation. Each source-observed spelling is
retained as an Instructor Alias with its source commit and file provenance. The
registry is append-only: future seed updates must preserve UUIDs when a known
alias or Canonical Instructor Name is observed again. TBA is never an identity.

`lib/rankings/server.ts` validates the filenames, declarations, Parquet framing,
v0 schemas, relation grains, finite measures, latest-Term relationships,
Instructor registry, and representative queries before opening the generation
to `queryRankings` or `getRankings`. A validation failure stays inside the
rankings module and renders the ranking-specific unavailable state.

The included seed is Hugging Face dataset commit
`0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d`. Its declarations come from the
expanded dataset tree, and the committed bytes match that commit's LFS objects.

## Public explorer

`/rankings/courses` and `/rankings/instructors` both call `queryRankings`; pages
never read Parquet directly. Term, activity, search, entity-specific filters,
preset or custom criterion weights, and continuation cursor are represented in
the query string. Cursors bind the accepted generation, normalized query, and
last result, so a replaced generation cannot be mixed into an existing page.
Course and association-title queries additionally bind the SHA-256 digest of
the exact generated course-catalog bytes, preventing a catalog refresh from
mixing result membership across cursor pages.

Course titles and current Common Core category labels come from the generated
course catalog refreshed by `bun run update-data` (and by `prebuild`). The
ranking module validates required catalog fields before serving dependent
queries. Ranking scores and Course–Instructor associations continue to come
only from the validated immutable ranking generation.

## Runtime refresh and retention

`GET` and `POST /api/rankings/refresh` are the same idempotent refresh
operation. Both require a Bearer token matching `CRON_SECRET` (or the local
`RANKINGS_REFRESH_SECRET` alias). `POST` accepts `{ "sha": "<40 hex>" }` from
the upstream publication workflow; `GET` resolves the current full SHA for the
daily Vercel fallback. Configure the GitHub `RANKINGS_REFRESH_URL` secret and
set its `RANKINGS_REFRESH_SECRET` secret to the same high-entropy value as the
deployment's `CRON_SECRET`.

The operation verifies the immutable Hugging Face revision and expanded tree,
streams exactly the five LFS objects within configured resource bounds, checks
each declared SHA-256 and size, builds the provenance-bearing Instructor
registry, and runs the same schema, grain, finite-value, latest-Term, and smoke
validation used for the seed. It retries three times with bounded backoff.

Complete generations are written under immutable private Space keys before a
single active pointer is replaced. A PostgreSQL advisory lock excludes jobs
across instances, and the source publication time prevents an older immutable
commit from regressing that pointer. The pointer retains the previous accepted
SHA. Readers bind one generation for an entire query; a failed refresh leaves
the pointer untouched and serves the in-memory generation, active/previous
Space generation, or validated seed in that order. `/tmp` and process memory
are caches only.

Required deployment variables are listed in `.env.example`. The Space must be
private and use restricted credentials; do not reuse attachment-publication
credentials. `GET /api/health/rankings` reports only status, active SHA,
freshness timestamps, and the bounded failure class. It never returns Space
keys, endpoints, database details, or credentials.

The owner must create the private SGP1 Space, restricted key, PostgreSQL URL,
and deployment/GitHub secrets before production activation. Release readiness
must still verify Vercel Bun native DuckDB loading, memory high-water, query and
refresh duration, cold/warm Space downloads, daily cron authentication, and
concurrent refresh behavior in a preview deployment; no local test invents
those credentials or deployment results.
