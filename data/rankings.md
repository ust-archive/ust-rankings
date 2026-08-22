# Ranking generations

A generation contains the required ranking, Course, association, and Instructor
identity Parquet relations plus its application-owned `manifest.json`.
Development and production lazily download the accepted immutable
`ust-archive/ust-rankings` Hugging Face generation into the operating system's
temporary directory. Tests install generated fixture generations through the
Ranking runtime reset helper and remain offline.

The manifest pins the immutable source commit and declares the six Course,
rating, and association Parquet files' SHA-256 hashes and byte sizes. The four
Instructor identity Parquet relations are required and validated separately.
The generation publishes a permanent application UUID for each Instructor and
keeps Canonical Instructor Name as display data. Each source-observed spelling
is retained as an Instructor Alias with its source commit and file provenance.
Identity history is append-only: each publication preserves UUIDs from the
previous identity-aware Ranking Generation. If those identity artifacts are
unavailable, publication fails rather than minting a parallel registry. An
intentional first identity-history publication may use
`npm run run -- --init` to start with empty event and split-association
relations; Instructor identities and aliases remain required. TBA is never an
identity.

`lib/rankings/server.ts` validates filenames, declarations, Parquet framing, v0
schemas, relation grains, finite measures, latest-Term relationships,
Instructor identities, and representative queries before opening a generation
to `queryRankings` or `getRankings`. A validation failure stays inside the
Rankings module and renders its unavailable state.

## Public explorer

`/rankings/courses` and `/rankings/instructors` both call `queryRankings`; pages
never read Parquet directly. Term, activity, search, entity-specific filters,
preset or custom criterion weights, and continuation cursor are represented in
the query string. Cursors bind the accepted generation, normalized query, and
last result, so a replaced generation cannot be mixed into an existing page.
Course and association-title queries additionally bind the declared SHA-256 of
the accepted `courses.parquet`.

Course titles and current Common Core category labels come from the accepted
Course dimension. The Ranking module validates its declaration, framing,
checksum, schema, required values, non-empty contents, and Course Code grain,
then joins it to ranking evidence and Course–Instructor associations in DuckDB.

## Runtime refresh and retention

`GET` and `POST /api/rankings/refresh` are the same idempotent refresh
operation. Both require a Bearer token matching `CRON_SECRET` (or the local
`RANKINGS_REFRESH_SECRET` alias). `POST` accepts `{ "sha": "<40 hex>" }` from
the upstream publication workflow; `GET` resolves the current full SHA for the
daily runtime fallback.

The operation verifies the immutable Hugging Face revision and expanded tree,
streams the Course, rating, association, and identity Parquet objects within
configured resource bounds, checks each declared SHA-256 and size, builds the
provenance-bearing Instructor registry, and runs the same validation used for
a generated test fixture. It retries three times with bounded backoff.

Complete generations are validated in the operating system's temporary
directory before a single active pointer is replaced. A PostgreSQL advisory
lock excludes overlapping refreshes, and the source publication time prevents
an older immutable commit from regressing that pointer. The pointer retains the
previous accepted SHA. Readers acquire one generation snapshot for an entire
public operation; a failed refresh leaves the pointer untouched and keeps the
in-memory generation if one is already accepted. Hugging Face is the source of
truth. Rankings stay unavailable until a generation is accepted. Only active
and previous snapshots are retained; retired DuckDB instances, connections,
and temporary directories are removed after in-flight readers finish.

Course–Instructor association keys are validated for completeness, uniqueness,
and consistent Term Code/Term Number mapping. They are intentionally not
foreign keys to Course or Instructor rating evidence: the source relation also
contains valid teaching associations for entities without SFQ/rating rows.

Required deployment variables are listed in `.env.example`.
`GET /api/health/rankings` reports only status, active SHA, freshness
timestamps, and the bounded failure class. It never returns storage paths,
database details, or credentials.
