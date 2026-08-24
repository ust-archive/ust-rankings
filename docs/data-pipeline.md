# Data pipeline

The DuckDB pipeline combines Catalog, Schedule, UST Space, and SFQ Parquet data into one immutable Ranking Generation. The generation contains Course metadata, longitudinal rating evidence, latest-Term views, Course–Instructor associations, and the complete Instructor identity snapshot.

## Flow

The executable specification is the ordered SQL pipeline:

1. [`00_sources.sql`](../data/sql/00_sources.sql) loads source Parquet relations, selects each logical record's latest event, and keeps active state.
2. [`10_observations.sql`](../data/sql/10_observations.sql) validates source values and emits normalized observations, source-name associations, entity coverage, and Term grids.
3. [`20_ratings.sql`](../data/sql/20_ratings.sql) computes rolling standardization, time-decayed estimates, empirical-Bayes adjustment, reliability, and posterior uncertainty.
4. [`30_export.sql`](../data/sql/30_export.sql) writes the public Parquet relations.

[`data/src/run.ts`](../data/src/run.ts) supplies paths and runs these stages. [`data/src/identities.ts`](../data/src/identities.ts) preserves identity from the previous Ranking Generation before export.

## Inputs

By default, the runner reads each source dataset's `main` revision from Hugging Face:

- Catalog Courses;
- Schedule Courses and Classes;
- UST Space Reviews;
- canonical SFQ Instructor and Section records.

Set `CATALOG_REVISION`, `SCHEDULE_REVISION`, `REVIEWS_REVISION`, and `SFQ_REVISION` to immutable commits for a reproducible build. `DATA_DIR` replaces the remote inputs with generated local fixtures for offline tests.

## Output contract

All outputs are Parquet relations in `data/out/`:

| Relation | Grain or role |
| --- | --- |
| `courses.parquet` | One row per current Course Code. |
| `course-ratings.parquet` | `(subject, code, term_num, criterion)` across all Terms. |
| `instructor-ratings.parquet` | `(uuid, term_num, criterion)` across all Terms; `name` is display data. |
| `course-rankings.parquet` | Latest-Term Course rating rows. |
| `instructor-rankings.parquet` | Latest-Term Instructor rating rows. |
| `course-instructors.parquet` | `(uuid, term_num, subject, code)` association bridge. |
| `instructor-identities.parquet` | Current Canonical Instructor Name and optional ITSC by Instructor UUID. |
| `instructor-aliases.parquet` | Source-observed Instructor names and provenance by Instructor UUID. |
| `instructor-identity-events.parquet` | Append-only ITSC, merge, and split history. |
| `instructor-split-affected-associations.parquet` | Append-only typed Instructor Association Corrections; columns are `correction_type`, `source_commit`, `target_uuid`, `source_name`, optional `term_code`, and `course_code`. The filename is retained for storage compatibility. |

The rating relations contain dense longitudinal history. The ranking relations contain the same measures for the latest source Term; they do not contain a precomputed Rank, percentile, or population size. Consumers select a criterion and population, then rank `bayesian` dynamically.

## Instructor identity continuity

The pipeline never mints identity during a normal publication. It loads all four identity relations from the previous identity-aware Ranking Generation and fails when any are missing. `--init` permits missing event and split-association relations only for an intentional first identity-history publication; identities and aliases remain required.

Current source spellings are clustered conservatively. Token and initial matches require supporting Course Offering evidence, co-Instructor co-occurrence blocks automatic clustering, and unresolved names fail rather than receiving a new UUID. Explicit merge history can override that guard when an upstream source duplicated one person. Canonical Instructor Names and aliases are display data and may be shared. Same-name Instructors remain distinct only when a prior UUID association or split history identifies the Course Offering association; otherwise publication fails closed. Schedule and UST Space spellings are preferred for the Canonical Instructor Name; SFQ is the fallback. TBA and program labels are not Instructors.

The daily build applies [`data/instructor-identity-corrections.json`](../data/instructor-identity-corrections.json) idempotently, then carries its events and calibrations forward in the Ranking Generation. Complete Schedule history preserves every already-resolved Course Offering. A new ambiguous same-name Course Offering still stops publication until an operator records exact evidence; the pipeline does not guess from cross-Term similarity.

Instructor Identity History is the shared projection of append-only ITSC, merge, split, and Instructor Association Correction records. It owns merge redirects and cycle detection, ITSC history, scoped matching, Term-specific-over-Course specificity, and equal-specificity conflict rejection.

An Instructor Association Calibration assigns one source-observed name on a Course to an existing Instructor UUID without merging identities. Omit `termCode` to calibrate every Term of that Course; include it to calibrate only that Course Offering. A Term-specific calibration takes precedence over a Course-wide calibration, and conflicting corrections stop publication. A split correction remains unresolved when a different UUID is presented; a Calibration resolves directly to its target. The observed spelling remains alias evidence; its Course scope supplies the identity evidence.

```json
{
  "sourceName": "YAN, Dengfeng",
  "courseCode": "CIVL 3420",
  "termCode": "2430",
  "instructorUuid": "b0c68636-93ef-4245-b3ec-c201f151fcfb",
  "sourceCommit": "49563e8584fa70d836c634a663db0ad52c1b25dd"
}
```

## Model semantics

### Observations

`observations` contains one row per source rating and criterion. `observation_instructors` is its many-to-many Instructor bridge. Schedule records provide Course and Instructor coverage, not zero-weight ratings.

Review criteria are `content`, `teaching`, `grading`, and `workload`. Each valid Review has one sample; with `net_votes = upvotes - downvotes`, confidence is `max(0.25, 1 + net_votes)`.

SFQ criteria are `course` and `instructor`. Effective response weight uses bounded invitations, response rate, and a response-rate reliability factor. Duplicate survey artifacts under several department attributions collapse before observations are emitted.

### Terms and weighting

Term Number is the dense HKUST index:

```text
term_num = 4 * YY + season - 1
```

Fall, Winter, Spring, and Summer use seasons 1–4. Each entity is emitted from its first evidence or coverage Term through the latest source Term.

For report Term `n` and output Term `m`, time confidence is:

```text
0.65 ^ ((m - n) / 4)
```

Course history taught by any Instructor in the current Course Term receives a 12× context multiplier. Instructor history has no such multiplier.

### Standardization and Bayesian adjustment

For each criterion and output Term, DuckDB calculates the confidence-weighted population mean and standard deviation from observations available through that Term. Course and Instructor families are adjusted separately. Every entity in a family shrinks toward one inclusive population prior; zero-sample entities receive that prior without changing it.

Outputs include standardized `rating`, posterior `bayesian`, confidence, current and cumulative samples, effective samples, reliability, and posterior standard deviation. Criteria remain separate. Deferred model validation is tracked in [#99](https://github.com/ust-archive/ust-rankings/issues/99).

## Browser Delivery Dataset and Server Index

`data/src/delivery.ts` exposes `buildDeliveryGeneration()`, and
`data/src/build-delivery.ts` provides the `npm run build-delivery --workspace data -- ...`
CLI. It accepts separate Ranking and Schedule archive directories plus their
immutable 40-hex revisions and stages one generation under the configured
output directory. Mutable revisions such as `main` are rejected. Each input
directory must include the source manifest produced from the pinned Hugging
Face tree, declaring the revision, byte size, and SHA-256 of every consumed
artifact; the derivation verifies those declarations before reading data.

The derivation leaves the full-fidelity archive inputs untouched. It writes the
browser Delivery Dataset as the ten Parquet relations `courses.parquet`,
`course-ratings.parquet`, `instructors.parquet`, `instructor-ratings.parquet`,
`relation.parquet`, `instructor-aliases.parquet`,
`instructor-identity-events.parquet`, `instructor-split-associations.parquet`,
`schedule-courses.parquet`, and `schedule-classes.parquet`. Rating projections
retain every historical row while keeping only the browser contract columns;
Instructor names remain in `instructors.parquet` rather than the rating rows.

The same generation writes a compressed `server-index.json.gz` containing the
Course, Instructor identity/history, relation, active Course Offering, active
Class, and resolvable Class–Instructor facts needed by community-write
validation. It reuses the Instructor Identity History projection for redirects
and scoped Instructor Association Corrections.

`manifest.json` records schema version, the pinned `rankings` and `schedule`
revisions, every Delivery artifact's immutable Spaces CDN URL, byte size, and
SHA-256, plus the Server Index's relative staged URL and declaration. The generation SHA is a SHA-256 of the schema version, pinned revisions,
ordered Delivery artifact hashes, and the compressed Server Index with its
embedded generation blanked. The manifest records that canonical Server Index
identity hash so browser clients can verify the same non-circular identity.
Output directories are generation-named and
installed by atomic rename, so failed builds cannot promote partial data and
older generations remain available for rollback.

The application activates a staged Server Index through the authenticated
`POST /api/server-index/activate` operation. The request declares the generation,
immutable Spaces generation URL, compressed byte size, and SHA-256. The same
artifact remains canonical on Hugging Face; the service reads its public mirror
without credentials. The service bounds the download and decompression, verifies the complete index
and its identity history, builds immutable lookup Sets/Maps, and only then swaps
the active reference. Repeating the active generation is idempotent; any failed
replacement leaves the previous reference active.

At process startup the service resolves `latest.json`, verifies its matching
Delivery manifest, and loads that manifest's immutable Server Index URL. Review
and Signal writes await an in-progress startup load and use the active index for
Course, Instructor, relation, Course Offering, Class, redirect, and scoped
correction validation. Community reads continue querying PostgreSQL directly.
Until the final native-DuckDB cutover, only a verified legacy Delivery manifest
with no Server Index retains the existing write validator. Unresolved, failed,
or in-progress activation fails closed when no previous index exists; once an
index is active, it is authoritative.

## Browser Course queries

Each browser tab resolves `latest.json` once, verifies the content-derived
Delivery manifest, and pins that immutable generation for the tab lifetime.
One process-wide query Worker is created outside React lifecycles; it owns the
DuckDB-Wasm worker and keeps ranking/filtering work off the main thread. Pinned
Worker and Wasm assets are copied from the locked npm package into the
application image and restricted to the same origin by CSP. The runtime
registers every immutable artifact immediately, preloads only Catalog
and Instructor identity data, and lets DuckDB fetch Course rating and
`relation.parquet` ranges when typed Catalog, Course Ranking, or Course detail
operations need them.

Course Ranking controls, pagination, search, presets, structured filters,
historical evidence, and Course–Instructor relations call that typed browser
interface; UI modules contain no SQL. Course routes server-render Course Code,
Schedule identity when available, Reviews, and Signals independently, then
fill the Ranking section from the pinned generation. Manifest, Worker,
WebAssembly, CDN, or query failure produces an explicit unavailable state and
never calls a server Course-query fallback.

Instructor Ranking and detail operations use the same tab-pinned Worker. They
load `instructor-ratings.parquet` and the shared `relation.parquet` lazily,
resolve UUID merge families and scoped correction history from the preloaded
identity relations, and preserve zero-sample Rank behavior. Instructor list
pagination, filters, presets, alias/ITSC search, identity history, historical
rating evidence, and Course relations have no server Ranking-query fallback.
Static identity and Community content remain server-rendered while the Worker
section loads or reports unavailable.

Schedule Course, Course Offering, Class, and Instructor-Class operations also
use the tab-pinned Worker. `schedule-courses.parquet` and
`schedule-classes.parquet` stay unrequested until a Schedule view needs them;
latest active events are projected into typed meetings, venues, enrollment,
reservations, and Instructor associations through `relation.parquet`. Failure
shows an explicit Schedule-unavailable state while Rankings and Community stay
usable. Calendar subscription UI and both `.ics` routes are removed; no
server-side calendar query path remains.

## Publication and rollback

The `Update data` workflow resolves every source `main` pointer to a 40-hex
revision before building. It publishes the unchanged full-fidelity Ranking
archive at the Hugging Face repository root, derives the paired browser
projection from that pinned commit and the pinned Schedule archive, and uploads
the immutable generation under `browser/<generation>/` on Hugging Face.

The publisher mirrors the generation to `ust-rankings-data`, confirms every
object with `HEAD`, calls the authenticated Server Index activation operation,
and only then writes `latest.json`. A failed upload or activation never changes
latest. Immutable generation objects use year-long cache metadata and remain in
both stores. The workflow's `rollback` action takes an existing generation,
reactivates its Server Index first, repoints latest second, and verifies the
manifest plus a real CDN Parquet byte range; it never deletes newer generations.
