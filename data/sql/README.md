# SQL pipeline

The numeric prefixes are an ordering convention, not a DuckDB requirement.
They expose dependencies in directory listings, while gaps of ten leave room
for a new stage. `src/run.ts` lists the files explicitly, so execution does not
depend on filesystem ordering.

| Stage | Reads | Produces |
| --- | --- | --- |
| `00_sources.sql` | Source Parquet files | Current-state `source_*` tables |
| `10_observations.sql` | `source_*` tables | Observations, identity bridges, entity coverage, and term grids |
| `20_ratings.sql` | Normalized tables | Historical rating marts and latest-term views |
| `30_export.sql` | Marts, views, and course-instructor bridge | Five public Parquet files |

## Main relations

| Relation | Grain or role |
| --- | --- |
| `observations` | One rating value for one criterion and source artifact |
| `observation_instructors` | Many-to-many link from evidence to canonical instructor names |
| `course_terms` / `instructor_terms` | Dense output grids from first coverage through the latest term |
| `course_term_instructors` | Course-to-instructor associations by term |
| `course_ratings` / `instructor_ratings` | Full historical rating marts |
| `course_rankings` / `instructor_rankings` | Latest-term views of the rating marts |

## Runner variables

`src/run.ts` supplies the input variables used by `00_sources.sql`:

```text
schedule_classes, schedule_courses, reviews, sfq_instructors, sfq_sections
```

It also supplies the output variables used by `30_export.sql`:

```text
course_ratings_parquet, instructor_ratings_parquet,
course_rankings_parquet, instructor_rankings_parquet,
course_instructors_parquet
```

Model behavior and public schemas are documented in
[`SPECIFICATION.md`](../SPECIFICATION.md). Runtime and consumer examples are in
the project [`README.md`](../README.md).
