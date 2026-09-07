# Prospective validation

This tool writes forecasts without scoring future outcomes, then evaluates a
separately sealed outcome batch once. It reuses `00_sources.sql`,
`10_observations.sql`, `11_backtest_weights.sql`, `20_ratings.sql`, and the accepted
Instructor identity builder. It does not change production exports or parameters.

The August 2026 snapshot already contained Review outcomes in Term 103. The old
`future-holdout.json` cannot establish independence. A new protocol requires a
declared inspected-outcome ceiling of at least 103 and a first outcome Term strictly
after it. **Term 104 is only the earliest permitted boundary; it is not known to be
unseen.** Declare any higher inspected boundary before creating a protocol.

## Freeze before acquiring outcomes

Prepare a JSON protocol request:

```json
{
  "knownOutcomeCeilingTerm": 103,
  "firstOutcomeTerm": 104,
  "inspectedSourceRevisions": ["0123456789abcdef0123456789abcdef01234567"]
}
```

These values are illustrative. Use the actual inspected boundary and immutable
revisions; all previously declared development revisions are included automatically.

```sh
npm --prefix data run prospective -- protocol request.json /absolute/seals/protocol.json
```

The command refuses an existing destination and prints the protocol hash. Publish
the protocol and hash in independently auditable storage before acquiring outcomes.
It freezes the two original candidates, four simple baselines, primary units,
minimum counts, paired bootstrap settings, point-error guardrails, source-noise
interval rule, nominal coverage targets, and implementation/dependency hashes.
Evaluation requires that same implementation checkout and dependency lock.

The nominal interval targets are 50%, 80%, 90%, and 95%. The predeclared coverage
gate requires empirical coverage at least the corresponding target at every level.
The simple-baseline gate requires strictly lower primary MAE than every baseline.
These gates are prospective rules, not thresholds selected on new outcome values.

## Seal a forecast

The forecast JSON configuration contains `protocolPath`, integer `cutoffTerm`, and
`files`. Each file descriptor has a flat logical `name`, absolute local `path`,
actual-byte `sha256`, immutable 40-character source `revision`, and UTC
`acquiredAt` timestamp. For example:

```json
{
  "name": "sfq-instructors.parquet",
  "path": "/absolute/sources/sfq/canonical/instructor_records.parquet",
  "sha256": "replace-with-the-actual-64-character-sha256",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "acquiredAt": "2026-09-07T00:00:00.000Z"
}
```

All thirteen files are required:

| Logical name | Source artifact |
| --- | --- |
| `catalog-courses.parquet` | Catalog `courses.parquet` |
| `schedule-classes.parquet` | Schedule `classes.parquet` |
| `schedule-courses.parquet` | Schedule `courses.parquet` |
| `schedule-class-records.parquet` | Schedule `canonical/class_records.parquet` |
| `schedule-course-records.parquet` | Schedule `canonical/course_records.parquet` |
| `reviews.parquet` | UST Space `reviews.parquet` |
| `sfq-instructors.parquet` | SFQ `canonical/instructor_records.parquet` |
| `sfq-sections.parquet` | SFQ `canonical/section_records.parquet` |
| `previous-instructor-identities.parquet` | Accepted ranking generation identities |
| `previous-instructor-aliases.parquet` | Accepted ranking generation aliases |
| `previous-instructor-identity-events.parquet` | Accepted ranking generation identity events |
| `previous-instructor-split-affected-associations.parquet` | Accepted generation association corrections |
| `previous-course-instructors.parquet` | Accepted generation associations |

```sh
npm --prefix data run prospective -- forecast forecast-config.json /absolute/seals/forecast-103
```

Every raw source Term must be known and no later than the cutoff, including records
that ordinary scoring might discard. Unknown or future Terms fail closed; the tool
does not silently filter an archive. If historical archives require curation,
publish a separate immutable curated revision with its derivation and actual file
hashes, and audit that curation before forecasting. Identity associations also
cannot extend beyond the cutoff. All files are privately copied and hash-verified
before fitting; their exact bytes are copied into the seal.

The writer extends the dense prediction grid to the cutoff without adding teaching
assignments. It freezes source-scale predictions and model standard deviations,
accepted UUIDs, and unambiguous exact aliases. Simple baselines use the current
candidate's past-only history: population mean, unshrunk mean, latest-Term mean,
and rolling mean over all retained past observations. Missing entity history falls
back to the population mean. Baseline interval widths reuse the current model's
width and are diagnostics; candidate coverage gates apply to candidate intervals.

Every forecast also freezes its past observation sample count and, for an
Instructor, the number of distinct Courses with past Instructor-specific SFQ.
The seal separately records the complete Schedule-backed Course Ranking Population
at the cutoff, including Courses with no finite forecast. These are source-history
features, not candidate-specific confidence weights.

Publish the printed forecast hash before acquiring outcomes. The local shared Git
directory also stores exclusive creation registrations under
`rankings-prospective-receipts/seals`. Recomputing a modified seal's hash does not
register it. Preserve this registry across worktrees and future evaluation runs.

## Seal and evaluate outcomes

An outcome configuration contains `protocolPath`, `forecastSeals` (each with
`directory` and the previously published `sha256`), and the same eight source
descriptors. No previous-identity files are accepted here: the forecast owns the
identity snapshot. New SFQ/Review revisions must be absent from the inspected list
and acquired after forecast registration. Unchanged Catalog/Schedule revisions
can be reused. Outcome extraction folds and normalizes sources but never fits a
model. It retains outcomes at or after the declared first outcome Term.

```sh
npm --prefix data run prospective -- outcomes outcome-config.json /absolute/seals/outcomes
```

The evaluator selects the latest shared sealed cutoff strictly before each outcome
Term, within four Terms. It never averages several forecasts for one outcome.
Instructor outcomes use only unambiguous aliases already accepted at that cutoff;
unknown or ambiguous names remain unknown and are counted in coverage. Candidate
and baseline comparisons use identical eligible units. Repeated raw observations
within a primary unit are averaged to one outcome before calculating primary MAE;
raw-observation metrics remain separate.

The source Class context uses the same canonical Schedule reconstruction as the
retrospective report. Outcomes seal their Course Code and known team size; Review
outcomes and unmatched Classes retain unknown team context. Secondary reports show
equal-unit errors by entity, evidence density, cold Instructor, cold Course,
solo/team/unknown context, and zero/one/multiple historical Courses. A primary unit
with several Classes can appear in more than one context stratum; their counts
must not be added as independent units. No future context changes a forecast.
Missing Course forecast history stays unknown, rather than being assigned zero
evidence. Placeholder names such as TBA and Staff do not count as team members:
TBA-only context is unknown, while one valid Instructor plus TBA is solo.
The shared placeholder correction also applies to newly generated retrospective
team diagnostics; previously archived research report counts were not regenerated.

Population follow-up uses the independently frozen Schedule denominator and counts
distinct member Courses receiving later Course-role SFQ or Review evidence within
the next four numeric Terms, even if no candidate forecast was available. Reports
state the observed outcome boundary and whether the window remains right-censored;
absence of evidence is not a claim that the Course was not taught.

An evaluation configuration contains `protocolPath`, the same `forecastSeals`,
`outcomeDirectory`, and the printed `outcomeSha256`:

```sh
npm --prefix data run prospective -- evaluate evaluation-config.json /absolute/reports/holdout.json
```

The CLI reserves the report destination before consuming outcomes, so a filename
collision cannot lose an evaluation. The tool verifies all registered hashes and source bytes, then permanently
claims both raw observation IDs and primary outcome units in a shared Git registry
before calculating errors. Changing the report path, copying a protocol, selecting
another worktree, or changing a source revision cannot reset consumption. A failure
after reservation, including insufficient counts, consumes those outcomes. Do not
retry an exploratory evaluation or delete its receipt. A crashed process may leave
an exclusive lock; preserve the receipt and investigate before recovering the lock.
Evaluate only after the sealed batch meets the predeclared minimum counts.

The report always sets `accepted: false` and `productionPromotion: false`. It
reports point-error, baseline, bootstrap and interval-coverage guard outcomes, but
local hashes and operator timestamps cannot establish that outcomes were unseen or
that an identity mapping was historically available. Independent acquisition
provenance must also verify that supplied revision IDs actually contain the
declared files; offline hashing does not authenticate a remote repository.
Genuinely new outcomes meeting all count thresholds and a separately
reviewed production decision remain external requirements. Moving to another
repository clone requires importing and auditing the existing registry; local files
cannot prevent deliberate deletion or falsification by their owner.
