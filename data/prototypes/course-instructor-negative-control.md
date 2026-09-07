# Development identity-shuffle control

This experiment for [#167](https://github.com/ust-archive/ust-rankings/issues/167) does not support promoting the crossed-effects prototype. The apparent Instructor residual gain survives identity shuffling, and a fixed population-offset baseline outperforms both the real and shuffled identities. These are retrospective development results, not independent confirmation.

## Frozen comparison

The run uses the [original pinned sources](course-instructor-offering.md#sources), with all fitted and scored SFQ observations capped at Term 102. It keeps the original strengths `(Course=1, Instructor=1, interaction=4)` and forward prediction rule: each evaluated Term uses only earlier Terms for training. No parameter selection or source refresh runs.

The two original fold groups remain `[94,95,96,98]` (5,211 observations, 1,080 evaluation Instructors) and `[99,102]` (2,020 observations, 910 Instructors). The latter was previously called a post-hoc holdout; both groups are now development data.

Ten Fisher–Yates permutations, using fixed LCG seeds 167–176, shuffle the prototype's Instructor labels within each Term. The labels are historical ITSCs or normalized-name fallbacks, not the production UUID mapping. A permutation changes which observation belongs to which Instructor while preserving each Term's label frequencies. It reassigns 99.64%–99.75% of labels. Original Instructor evaluation groups, observation weights, outcomes, Course estimates, and Class context remain fixed. The code asserts that the nonidentity baselines and outcomes remain unchanged.

The additional baseline adds the training population mean of `Instructor rating − Course rating` to the Course or Course-context estimate. It requires no Instructor identity and no tuning. All errors below are Instructor-balanced mean absolute errors; lower is better.

## Results

| Model | Original development Terms | Old post-hoc Terms |
| --- | ---: | ---: |
| Course only | 0.372712 | 0.379648 |
| Course + population offset | **0.301314** | **0.295330** |
| Course + real Instructor residual | 0.322365 | 0.328290 |
| Course context + population offset | **0.305443** | **0.296088** |
| Real crossed model | 0.329421 | 0.329871 |

The unshuffled development crossed error reproduces the saved original result `0.32942133039949745` exactly. Every shuffled run has lower residual and crossed error than the real identities, but higher error than its population-offset baseline.

| Improvement over matching population baseline | Original development Terms | Old post-hoc Terms |
| --- | ---: | ---: |
| Real Instructor residual | −0.021051 | −0.032960 |
| Shuffled Instructor residual, range over 10 seeds | −0.014293 to −0.010961 | −0.025456 to −0.020468 |
| Real crossed model | −0.023978 | −0.033783 |
| Shuffled crossed model, range over 10 seeds | −0.015920 to −0.011996 | −0.027059 to −0.020398 |

Positive improvement would favor the identity model. None appears here. The population Instructor-versus-Course offset explains an improvement that would otherwise be mistaken for evidence about particular Instructors. This comparison does not establish causality or prove that no better identity model could work; it does not support an incremental predictive benefit from this prototype on these already-inspected data.

## Equivalent observations

The valid source control replaces every mapped SFQ observation with two identical fragments, each carrying half its respondents, before the original SQL aggregation. It reconstructs the same 28,130 canonical Instructor-Class rows within `1e-12` for every numeric field, with identical nonnumeric fields. Prediction metrics agree to floating-point precision.

A separate adversarial control duplicates already-canonical team training rows with half their respondents. It changes 3,298 residual and 3,299 crossed predictions out of 7,231 (maximum changes 0.216667 and 0.277662), while leaving Course baselines unchanged. These duplicates violate the fitter's one-row-per-canonical-unit input contract. This is not a confirmed source-pipeline defect: it documents that the fitter counts rows and relies on upstream aggregation, rather than using respondent weight itself, to enforce the invariant.

## Cache provenance and reproduction

`crossed-rows.parquet` has SHA-256 `80acb25e2fa0b2c906ea41cfdf1abcf3393bf53fbedf716c276d54e87d5a7b5b`. Its 28,136 development rows contain six extra rows across four duplicated units, and it omits respondent counts. The runner therefore reconstructs the original respondent-weighted observations from the pinned source files, checks all 25,771 Classes' Instructor-unit counts against the cache, and verifies the original development metric. The earlier cache also retains name fallbacks for 1,651 Term-102 units that the original prototype resolves through unique historical ITSC names; the original prototype mapping is used consistently throughout this experiment.

With Node 26.7.0 and the repository dependencies installed, run from the repo root:

```sh
node data/prototypes/course-instructor-offering.ts \
  D:/Temp/ust-rankings-167-data \
  D:/Temp/ust-rankings-crossed-control \
  --negative-control
```

The complete per-seed output is captured in [course-instructor-negative-control.json](course-instructor-negative-control.json). It includes the source revisions and cache hash. The runner exits before the original model-selection path. No production code or ranking output is changed.

Verification on 2026-09-07: two complete runs produced identical raw JSON bytes (SHA-256 `f6ee82b3e89fde4869c58af4df3f4babd3c9bdc487750e1a969ede8712e3ba02`). The checked-in artifact uses repository JSON formatting (SHA-256 `7b93ec87e0625ea307427cf7d3463b1556e890e2ade7aabc7a5bc9d608823a6d`). Targeted strict TypeScript checking, Biome, and `git diff --check` pass. Independent code reviews checked both the fixed comparison and the observation boundaries.
