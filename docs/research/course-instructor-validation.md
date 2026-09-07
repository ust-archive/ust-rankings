# Research: Course, Instructor, and Course Offering validation

## Summary

The current backtest is useful for model development. It is not an independent confirmation. It uses retrospective source snapshots, and the same history was used to find candidates.

The analysis now separates Course outcomes from Instructor outcomes. It gives equal weight to each declared evaluation unit. It also keeps Class and Course Offering context in analysis-only Parquet files. Production parameters and production exports do not change.

The main findings are:

- The advisory `votes-unweighted-context-4` candidate has lower retrospective Course error than `current` under the new primary Course unit.
- The Instructor model beats the unshrunk baseline, but the simple rolling mean has lower retrospective error.
- Shared Course evidence with accepted identities has total allocation 1 across each teaching team. The checks found no duplicate context, allocated sample change, invalid allocation sum, or Instructor-evidence fan-out.
- The crossed Course + Instructor + Course Offering prototype did not beat the simpler baselines on its post-hoc holdout.
- A future holdout must confirm any production change. The frozen manifest is `data/validation/future-holdout.json`.

## Question

Can the project evaluate Course and Instructor predictions without these errors?

1. Large Courses or repeated rows control the result.
2. A shared Course observation becomes several independent Instructor observations.
3. Instructor quality absorbs a Course effect or a Course Offering effect.
4. A retrospective split is described as independent evidence.

## First-party source inventory

This research used authorized access to public and private `ust-archive` sources. It did not expose credentials or personal source rows.

| Source | Revision or location | Observed coverage | Allowed role |
| --- | --- | --- | --- |
| Hugging Face Catalog | `fd704a74bfc9fd9076680da3d80d0a7e304c7164` | Course metadata | Course identity and metadata |
| Hugging Face Schedule | `8710e83979c989401aab91972234659adbeaba0a` | Canonical Class history, Terms 92–104; 554,379 raw records | Course Offering, Class, enrollment, capacity, Section, and teaching-team context |
| Hugging Face SFQ | `880e90dbd3af759e1e91c85a1bb721197a79bd8d` | Canonical Instructor history, Terms 66–102; 68,474 raw records | Separate Course-role and Instructor-role outcomes |
| Hugging Face UST Space | `1069ca3822f00da12a22fee8f7ea4fc87dfe8344` | 37,009 Review events; 35,890 distinct hashes | Course-role Review evidence only |
| Hugging Face Faculty | `099191e2e41faaccc478cfaba2dfeb61d53f9702` | Faculty identity records | Instructor identity anchor only |
| Hugging Face Rankings | immutable generations | Previous accepted UUID registry and Rankings | Identity continuity and regression checks |
| Legacy SFQ files | three pinned Parquet files in the SFQ dataset | Terms 66–101; `instructor_itsc` is present on 28,670 rows | Instructor identity anchor only |
| GitHub `ust.space-data` | authorized private repository | UST Space collection and transformation code | Source provenance and schema review |
| GitHub `ust-cq` and `ust-sfq` | authorized repositories | Historical collectors and schemas | Source provenance and field semantics |
| GitHub `ust-rankings-data` | authorized private repository | Historical generated artifacts | Previous-generation identity continuity |
| GitHub `ust-cc` | authorized repository | Course-catalog tooling | Catalog provenance |

Other accessible datasets, such as Credit Transfer, do not answer this question. They are not model evidence in this analysis.

### Source-role rules

- A Review is Course evidence. It is not direct Instructor-performance evidence.
- Review votes are reactions to one Review. They are not independent rating samples.
- An SFQ Course rating is Course evidence.
- An SFQ Instructor rating is Instructor evidence.
- Faculty and `instructor_itsc` fields resolve identity. They are not performance evidence.
- Enrollment, capacity, Section, and team size are Course Offering context. They do not prove a causal quality effect.

## Analysis design

### Course unit

The primary Course unit is:

`Course Code × outcome Term × criterion`

Each unit has equal primary weight. For each eligible forecast cutoff, the analysis first averages repeated source outcomes and calculates error. It then averages those cutoff errors inside the declared unit. Source weights affect model fitting and a named secondary metric only.

The secondary Course views are:

- equal-Course error;
- equal-criterion error;
- raw-observation error;
- source-weighted error;
- respondent-count-weighted error;
- signed error;
- the unshrunk, population-mean, latest-observation, and rolling-mean baselines.

The paired candidate intervals use 2,000 deterministic resamples with seed 100. One interval resamples Course clusters. The other interval resamples outcome-Term blocks.

### Instructor unit

The primary Instructor unit is:

`accepted Instructor UUID × outcome Term`

Display names are not evaluation identities. Instructor outcomes come only from Instructor-role SFQ records. The analysis reports cold-Instructor, cold-Course, solo-taught, team-taught, and multi-Course strata.

The Instructor baselines are:

- unshrunk Instructor history;
- the population mean;
- the latest Instructor observation;
- the rolling Instructor mean;
- the Course prediction without an Instructor effect.

### Context and allocation relations

The analysis writes four files for each candidate:

- `evidence-context.parquet`;
- `evidence-allocations.parquet`;
- `course-analysis.parquet`;
- `instructor-analysis.parquet`.

The first file has one row for one source observation. It keeps the evidence role, canonical Schedule Course ID, Course Offering key, canonical Class key and number, Class role and type, Section, career, credits, enrollment, capacity, utilization, scheduled team size, source samples, invitation count, response rate, source standard deviation, and acquisition SHA-256 when these fields exist.

The second file has identity allocations. Shared Course-role or Review-role evidence with accepted identities has allocations that sum to 1 across the teaching team. Evidence without an accepted identity stays unallocated and is counted. Instructor-role evidence maps to one accepted UUID. Allocated samples and weights must sum to the one source observation.

These files are analysis artifacts. They are not production exports.

## Retrospective results

The report is `D:/Temp/ust-rankings-167-validation.json`. It used the pinned sources in this document. The final run took 127 seconds for nine candidates.

### Course results

| Candidate or baseline | Primary Course error |
| --- | ---: |
| `current` | 0.557931 |
| `votes-unweighted-context-4` | 0.516409 |
| Current rolling mean | 0.527729 |
| Current unshrunk | 0.566289 |
| Current population mean | 0.640223 |
| Current latest observation | 0.594027 |

The advisory candidate reduced the primary retrospective error by 0.041522, or 7.44%, relative to `current`. On the compatible row-level selector from PR #102, it reduced error from 0.734257 to 0.700064, or 4.66%. Its worst cutoff regression was 1.43%.

Its paired error difference had these intervals:

- Course-cluster 95% interval: `[-0.047979, -0.035140]`;
- outcome-Term block 95% interval: `[-0.045647, -0.037362]`.

These intervals measure stability inside the retrospective history. They do not remove post-selection bias. They do not authorize a production change.

The Course analysis contained 40,730 primary units, 2,645 Courses, 53 outcome Terms, and five Course-role criteria. Instructor-role SFQ outcomes were not counted as Course outcomes. The criterion-mismatch check found zero rows.

### Instructor results

For `current`, the primary Instructor error was 0.280544 across 11,256 units and 1,492 accepted UUIDs.

| Instructor model or baseline | Primary Instructor error |
| --- | ---: |
| Rolling Instructor mean | 0.277570 |
| Current shrunk Instructor model | 0.280544 |
| Unshrunk Instructor history | 0.284742 |
| Latest Instructor observation | 0.317306 |
| Course-only prediction | 0.319162 |
| Population mean | 0.341204 |

The current model improved on the unshrunk baseline by 0.004198, or 1.47%. It was 0.002973, or 1.07%, worse than the simple rolling mean. This result does not support an Instructor production change.

Course-only candidate parameters did not change Instructor predictions. The report does not claim an Instructor gain for those candidates.

### Context and invariant results

The analysis retained 199,494 source observations.

- 18,801 Class-linked observations had matched enrollment context.
- 37,185 Class-linked observations did not have matched enrollment context. Most of this history is before canonical Schedule coverage starts at Term 92.
- 36,867 identity-allocation rows belonged to teaching teams.
- 19,621 Course-role or Review-role observations had no accepted identity allocation. They stayed Course evidence and did not become Instructor evidence.
- The maximum allocation-sum error was `4.44 × 10^-16`.
- Duplicate context rows: 0.
- Duplicate Instructor allocations: 0.
- Invalid allocation sums: 0.
- Allocated sample or weight changes: 0.
- Missing Instructor-role allocations: 0.
- Instructor-role evidence with team fan-out: 0.

## Crossed-model prototype

The throwaway prototype is on a separate prototype branch. Its local report is `D:/Temp/ust-rankings-crossed/crossed-model.json`. Its interactive local demo is `D:/Temp/ust-rankings-crossed/crossed-model-demo.html`.

The prototype used:

- a partially pooled Course mean;
- an Instructor residual after the Course rating was removed;
- a strongly shrunk Course–Instructor interaction;
- enrollment and team-teaching deviations as Course Offering context;
- one shared allocation across a teaching team.

It used 28,130 aggregated Instructor SFQ rows. Of these rows, 27,858 had a historical ITSC identity anchor, 8,882 had canonical Class context, and 3,433 were team-taught rows.

The prototype selected shrinkage strengths on development Terms 94, 95, 96, and 98. It then evaluated Terms 99 and 102. This holdout is still post hoc because the outcomes were already available.

| Prototype comparison | Equal-entity error |
| --- | ---: |
| Course only | 0.332943 |
| Course with Offering context | 0.333453 |
| Raw Instructor history | 0.322138 |
| Course plus Instructor residual | 0.328290 |
| Full crossed model | 0.329871 |

The Course Offering context change was `+0.000510`. Its Course-cluster 95% interval was `[-0.002161, 0.003187]`.

The crossed Instructor change versus raw Instructor history was `+0.007733`. Its Instructor-cluster 95% interval was `[-0.005769, 0.020512]`.

The prototype did not show a reliable gain. The result supports the simpler current structure for now. It does not show that context has no value. It shows that this small model and this post-hoc split did not validate the added terms.

## Future holdout

`data/validation/future-holdout.json` freezes the next decision before future outcomes are inspected. Its frozen SHA-256 is `81cab9eb43d0dd6b62dd012e7bec9159d92a63c4d0752aa67df722d6755f0c47`.

The holdout starts at Term 103. It remains closed until it has at least:

- four outcome Terms;
- 1,000 Course units;
- 300 Courses;
- 500 Instructor units;
- 100 accepted Instructor UUIDs.

The manifest freezes `current` and `votes-unweighted-context-4`. It freezes the primary units, primary metrics, secondary views, identity rules, source-sealing rules, cluster intervals, and regression guardrails.

A production change requires a separate reviewed decision after the holdout is sealed. The backtest does not update production parameters automatically.

## Risks and limits

- Historical Review votes, edits, withdrawals, and identity knowledge cannot be reconstructed at every old cutoff. The current report is retrospective.
- Canonical Schedule context starts at Term 92. Earlier SFQ outcomes cannot use the same Class context.
- A source standard deviation and respondent count describe measurement precision. They do not make a large Class more important in the primary metric.
- Team-teaching allocation prevents sample multiplication. It does not identify each Instructor's causal contribution.
- An ITSC is a stronger identity key than a name, but historical mappings still need correction handling and audit history.
- The prototype holdout was selected after the data existed. It is not independent evidence.

## Recommended integration order

1. Keep the balanced analysis and context artifacts separate from production exports.
2. Use the frozen future-holdout manifest before any new outcome is scored.
3. Seal immutable Hugging Face revisions and file hashes before each holdout evaluation.
4. Keep Course-role and Instructor-role outcomes in separate tables.
5. Keep the one-observation, one-total-allocation invariant.
6. Do not add the crossed prototype to production unless a new predeclared candidate beats the simple baselines on an untouched holdout.

## Sources

- [Hugging Face Schedule](https://huggingface.co/datasets/ust-archive/schedule)
- [Hugging Face SFQ](https://huggingface.co/datasets/ust-archive/sfq)
- [Hugging Face UST Space](https://huggingface.co/datasets/ust-archive/ust-space)
- [Hugging Face Faculty](https://huggingface.co/datasets/ust-archive/faculty)
- [GitHub `ust-rankings`](https://github.com/ust-archive/ust-rankings)
- [Issue #167](https://github.com/ust-archive/ust-rankings/issues/167)
- [Issue #168](https://github.com/ust-archive/ust-rankings/issues/168)
