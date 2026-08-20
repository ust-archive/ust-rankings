# DuckDB rating specification

The executable specification is the ordered SQL pipeline:

1. [`00_sources.sql`](sql/00_sources.sql) reads Hugging Face Parquet event logs,
   selects the latest event for each logical record, then keeps active state.
2. [`10_observations.sql`](sql/10_observations.sql) validates source values,
   resolves conservative instructor identities, and emits normalized rating
   observations plus dense entity-term metadata.
3. [`20_ratings.sql`](sql/20_ratings.sql) computes rolling standardization,
   decayed course/instructor estimates, empirical-Bayes adjustment,
   reliability, and posterior uncertainty.
4. [`30_export.sql`](sql/30_export.sql) writes the relational Parquet artifacts.

## Output contract

All public outputs are Parquet relations in `out/`:

| Relation | Grain |
| --- | --- |
| `course-ratings.parquet` | `(subject, code, term_num, criterion)` across all terms |
| `instructor-ratings.parquet` | `(name, term_num, criterion)` across all terms |
| `course-rankings.parquet` | Latest-term course rating rows |
| `instructor-rankings.parquet` | Latest-term instructor rating rows |
| `course-instructors.parquet` | `(subject, code, term_num, name)` bridge |

The two ratings relations contain the full dense history. The two rankings
relations contain the same measures for the global latest term. They do not
contain a precomputed rank, percentile, or peer count. Consumers first select
their criterion and activity population, then rank `bayesian` dynamically.

Join course data to `course-instructors.parquet` with
`(subject, code, term_num)`, instructor data with `(name, term_num)`, and retain
`criterion` when identifying rating rows. The bridge combines associations
inferred from rating evidence with assignments from the available schedule.
Course rows expose `is_offered`; instructor rows expose `is_teaching`. Both
flags require an active schedule record for that entity and exact term,
independently of rating evidence. `is_teaching` is limited to primary (`E`
role) `LEC` and `IND` assignments.

## Normalized observations

`observations` contains one row per source rating and criterion:

```text
observation_id, source, term_num, term_code, subject, code,
criterion, rating, weight, samples
```

`observation_instructors` is its many-to-many instructor bridge. Schedule rows
provide coverage and current teaching context, not zero-weight rating rows.

Review criteria are `content`, `teaching`, `grading`, and `workload`. Each valid
review has `samples = 1`. With `net_votes = upvotes - downvotes`, its confidence
weight is `max(0.25, 1 + net_votes)`.

SFQ criteria are `course` and `instructor`. Course observations come from the
canonical section table. Instructor observations come from the canonical
instructor table. The effective response weight is based on bounded invitations
times response rate, with an additional response-rate reliability factor.
When one survey artifact is repeated under multiple department attributions,
the repeated rows are collapsed before observations are emitted.

## Instructor identities

Each raw spelling receives a normalized key that preserves token order. It
normalizes case, accents, punctuation, and whitespace, but does not make
`Wang Wei` and `Wei Wang` identical. Aliases may match on compatible name tokens
or initials only when course-term evidence supports the link. Candidate links
are direct, must have one unique best target, and are rejected when the
spellings occur together as co-instructors. Ties and other unresolved names
remain separate.

After clustering, schedule and UST Space review spellings are preferred as the
canonical `name`; an SFQ spelling is the fallback. The schedule export starts
at term code `2510`, so older-only aliases rely on review/SFQ course-term
evidence. Obvious placeholders and program labels are not treated as instructor
identities.

## Terms and weighting

Term number is the dense HKUST code index:

```text
term_num = 4 * YY + season - 1
```

where Fall, Winter, Spring, and Summer have seasons 1–4. Each entity is emitted
from its first observed/covered term through the latest source term.

For report term `n` and output term `m`, time confidence is:

```text
0.65 ^ ((m - n) / 4)
```

Course history taught by any instructor in the current course term receives a
12× context multiplier. Instructor history has no such multiplier.

## Rolling standardization

For each criterion and output term, DuckDB computes the weighted mean and
population standard deviation using observations at or before that term only.
An entity's weighted raw mean is then transformed with those rolling moments.
This is algebraically identical to transforming every report first, because the
same affine transform applies to the whole criterion/output-term slice.

## Bayesian adjustment

Course and instructor families are adjusted separately per criterion and term.
Each slice uses one inclusive, confidence-weighted population mean from all
entities in that slice. Every entity therefore shrinks toward the same prior;
the prior is not recomputed leave-one-out for each entity. Prior variance is the
observed entity variance less average observation noise, with a small positive
floor. Outputs include:

- `rating`: standardized cumulative estimate;
- `bayesian`: posterior mean that consumers may rank;
- `confidence`, current `samples`, cumulative samples, and effective samples;
- `reliability` and posterior standard deviation.

No composite across unlike criteria is invented. Consumers can choose the
dimension relevant to their decision without hiding the tradeoff in one opaque
number. Rank and percentile depend on the consumer's chosen population, so they
are intentionally calculated outside this pipeline.
