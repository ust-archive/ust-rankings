# Ranking generations

A generation contains the required ranking, Course, association, and Instructor
identity Parquet relations plus its application-owned `manifest.json`. Tests and local `RANKINGS_SEED_DIR` may
point at `seed/<Hugging Face commit SHA>/`. Production does not ship or serve
that seed.

The manifest pins the immutable source commit and declares every Parquet file's
SHA-256 and byte size. It also assigns permanent application UUIDs to the
Canonical Instructor Names in that generation. Each source-observed spelling is
retained as an Instructor Alias with its source commit and file provenance. The
registry is append-only: future seed updates preserve UUIDs through an
unambiguous Canonical Instructor Name or current ranking-generation observation.
Historical Instructor Aliases may be shared and never establish identity alone;
an ambiguous current observation fails closed. TBA is never an identity.

`lib/rankings/server.ts` validates the filenames, declarations, Parquet framing,
v0 schemas, relation grains, finite measures, latest-Term relationships,
Instructor registry, and representative queries before opening the generation
to `queryRankings` or `getRankings`. A validation failure stays inside the
rankings module and renders the ranking-specific unavailable state.

The legacy seed at `seed/0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d`
is retained only as the pipeline's initial Instructor identity bootstrap. It is
not a valid runtime generation because it predates the required Course
dimension.

## Public explorer

`/rankings/courses` and `/rankings/instructors` both call `queryRankings`; pages
never read Parquet directly. Term, activity, search, entity-specific filters,
preset or custom criterion weights, and continuation cursor are represented in
the query string. Cursors bind the accepted generation, normalized query, and
last result, so a replaced generation cannot be mixed into an existing page.
Course and association-title queries additionally bind the declared SHA-256 of
the accepted `courses.parquet`, preventing different Course metadata from
mixing result membership across cursor pages.

Course titles and current Common Core category labels come from the accepted
Course dimension. The ranking module validates its declaration, framing,
checksum, schema, required values, non-empty contents, and Course Code grain,
then joins it to ranking evidence and Course–Instructor associations in DuckDB.

## Instructor identity corrections

`instructor-registry.json` is the pipeline's append-only correction input.
`RANKINGS_INSTRUCTOR_REGISTRY_FILE` is read by the data pipeline, not by app
refresh. Each published ranking generation includes identity Parquet; the app
serves those Instructor UUIDs and does not mint identity at runtime.

Do not add a correction without authoritative evidence. Adding an ITSC keeps
the Instructor UUID; retired UUID and ITSC routes permanently redirect to the
merge survivor. The correction becomes part of the next accepted immutable
generation, where it remains available to routes, search, and identity-history
presentation.

## Runtime refresh and retention

`GET` and `POST /api/rankings/refresh` are the same idempotent refresh
operation. Both require a Bearer token matching `CRON_SECRET` (or the local
`RANKINGS_REFRESH_SECRET` alias). `POST` accepts `{ "sha": "<40 hex>" }` from
the upstream publication workflow; `GET` resolves the current full SHA for the
daily runtime fallback. Configure the GitHub `RANKINGS_REFRESH_URL` secret to
the DigitalOcean app endpoint and set `RANKINGS_REFRESH_SECRET` to the same
high-entropy value as the deployment's `CRON_SECRET`.

The operation verifies the immutable Hugging Face revision and expanded tree,
streams the Course, rating, association, and identity Parquet objects within configured resource bounds, checks
each declared SHA-256 and size, builds the provenance-bearing Instructor
registry, and runs the same schema, grain, finite-value, latest-Term, and smoke
validation used for a local seed. It retries three times with bounded backoff.

Complete generations are written under `/tmp/ust-rankings` on the running
instance before a single active pointer is replaced. A PostgreSQL advisory lock
excludes overlapping refreshes, and the source publication time prevents an
older immutable commit from regressing that pointer. The pointer retains the
previous accepted SHA. Readers acquire one generation snapshot for an entire
public operation; a failed refresh leaves the pointer untouched and keeps the
in-memory generation if one is already accepted. There is no image seed and no
shared last-known-good across instances: Hugging Face is the source of truth.
The process warms from Hugging Face on `next start` and again daily. Rankings
stay unavailable until a generation is accepted. Only active and previous native
snapshots are retained. Retired DuckDB instances/connections close after their
in-flight readers finish, and their owned `/tmp` directories are removed.

Course–Instructor association keys are validated for completeness, uniqueness,
and consistent Term Code/Term Number mapping. They are intentionally not
foreign keys to Course or Instructor rating evidence: the source relation also
contains valid teaching associations for entities without SFQ/rating rows.

Required deployment variables are listed in `.env.example`. `GET
/api/health/rankings` reports only status, active SHA, freshness timestamps, and
the bounded failure class. It never returns storage paths, database details, or
credentials.
