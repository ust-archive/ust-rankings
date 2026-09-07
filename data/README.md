# UST data

DuckDB builds Course and Instructor ratings directly from the
[`ust-archive`](https://huggingface.co/ust-archive) Parquet datasets. SQL owns
the cleanup and calculations; [`src/run.ts`](src/run.ts) supplies paths and runs
the files in [`sql/`](sql/). The full contract is documented in
[`docs/data-pipeline.md`](../docs/data-pipeline.md).

The inputs are [`catalog`](https://huggingface.co/datasets/ust-archive/catalog),
[`schedule`](https://huggingface.co/datasets/ust-archive/schedule),
[`ust-space`](https://huggingface.co/datasets/ust-archive/ust-space), and
[`sfq`](https://huggingface.co/datasets/ust-archive/sfq). The current schedule
export starts at term `2510`; older rating observations remain, but historical
schedule-only coverage from the retired CQ source does not.

## Run

Requires the repository-pinned Node 26 and npm 12 toolchain and access to the private
`ust-archive/ust-space` and `ust-archive/sfq` datasets. Authenticate with either
`HF_TOKEN` or a token in the standard Hugging Face cache. The `hf` CLI is needed
only if you choose to create that cached token with `hf auth login`; it is not
used by the runner.

Install the repository workspace from the root, then run the pipeline:

```sh
npm ci
npm run data:run
```

For an offline/local run, set `DATA_DIR` to a directory with this
layout; authentication is then unnecessary:

```text
catalog/courses.parquet
schedule/{classes,courses}.parquet
schedule/canonical/{class_records,course_records}.parquet # data:backtest only
ust-space/reviews.parquet
sfq/canonical/{section_records,instructor_records}.parquet
```

The runner reads each dataset's `main` revision by default. Set
`CATALOG_REVISION`, `SCHEDULE_REVISION`, `REVIEWS_REVISION`, and `SFQ_REVISION`
to commit hashes for a reproducible snapshot.

## Outputs

The build writes relational Parquet files to `out/`, including:

| File | Contents |
| --- | --- |
| `courses.parquet` | Current Course dimension; one row per Course Code from the latest active Catalog Term. |
| `course-ratings.parquet` | Full course history; one row per course, term, and criterion. |
| `instructor-ratings.parquet` | Full instructor history; one row per instructor, term, and criterion. |
| `course-rankings.parquet` | Course ratings for the latest pipeline term only. |
| `instructor-rankings.parquet` | Instructor ratings for the latest pipeline term only. |
| `course-instructors.parquet` | Observed course-to-instructor associations by term. |

The rating files are longitudinal marts. The ranking files are convenient
latest-term snapshots of those marts, not a separate model. Course rows join
on `(subject, code, term_num)` and Instructor rows on `(uuid, term_num)` through
`course-instructors.parquet`. The bridge contains associations inferred from
rating evidence as well as current schedule assignments.

`uuid` is the Instructor identity key; `name` is display and alias data selected
after source-name clustering. Include `criterion` when joining or identifying a
rating row. `is_offered` and
`is_teaching` come from active schedule data for that exact term;
`is_teaching` specifically means a primary (`E` role) `LEC` or `IND`
assignment. Filter those flags first, then calculate rank or percentile
dynamically from `bayesian` so the displayed positions match the population
visible in the frontend.

Query the files directly with DuckDB:

```sql
SELECT
  subject,
  code,
  bayesian,
  rank() OVER (ORDER BY bayesian DESC) AS rank
FROM read_parquet('out/course-rankings.parquet')
WHERE criterion = 'teaching'
  AND is_offered
ORDER BY rank
LIMIT 20;

WITH current AS (
  SELECT
    uuid,
    name,
    term_num,
    bayesian,
    rank() OVER (ORDER BY bayesian DESC) AS rank
  FROM read_parquet('out/instructor-rankings.parquet')
  WHERE criterion = 'teaching'
    AND is_teaching
)
SELECT r.uuid, r.name, a.subject, a.code, r.bayesian, r.rank
FROM current AS r
JOIN read_parquet('out/course-instructors.parquet') AS a
  USING (uuid, term_num)
ORDER BY r.rank, a.subject, a.code;
```

Run `npm run type-check` and `npm run test` for static analysis and the
end-to-end pipeline test. Walk-forward model validation is available through
[`npm run data:backtest`](../docs/data-pipeline.md#walk-forward-model-validation).
The backtest report also contains analysis-only Course and Instructor results.
The primary Course unit gives equal weight to each
`Course Code × outcome Term × criterion`. The primary Instructor unit gives
equal weight to each `Instructor UUID × outcome Term`. Canonical Schedule Class
records add enrollment, capacity, Section, and teaching-team context. These
fields do not change the production output files.

Retrospective backtests reject any outcome after the frozen development ceiling
in `validation/future-holdout.json`, including the legacy comparison export.
Use development-only input files with outcome Terms at or below that ceiling;
reserved future outcomes require a separate sealed evaluation. The report also
includes equal-unit error by criterion, source, evidence density, cold-start
state, teaching team, and number of historical Courses, plus raw-pair Gaussian
coverage at 50%, 80%, 90%, and 95%. These diagnostics do not select production
parameters or establish an independent holdout.
The report also fits empirical residual quantiles on outcome Terms through 91
and checks coverage on Terms 92-102, explicitly as a retrospective diagnostic.
Schedule-backed Ranking Population follow-up counts show how many eligible
Courses receive later evidence; final four-Term windows may be incomplete.

The separate [`prospective` workflow](validation/PROSPECTIVE.md) freezes past-only
forecasts, accepted identities, simple baselines, interval rules, and source
hashes before a later one-use outcome evaluation. It requires a fresh protocol;
the old Term-103 manifest does not establish unseen outcomes. The tool reports
frozen metric gates and never promotes production automatically.

The upstream dataset cards declare `license: other`; two inputs are private.

Identity history is projected by the shared `lib/instructor-identity.ts` module. The fourth identity artifact retains its storage filename but now contains typed Instructor Association Corrections: `correction_type`, `source_commit`, `target_uuid`, `source_name`, optional `term_code`, and `course_code`. Accepted Course–Instructor UUIDs are authoritative; the `name` column is display data.
