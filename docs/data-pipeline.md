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
