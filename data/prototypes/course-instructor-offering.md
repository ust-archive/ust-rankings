# Throwaway prototype: crossed Course, Instructor, and Course Offering effects

## Status

This prototype is for issue #167. It is not production code. Do not merge it into the production data path without an untouched holdout result and a separate design decision.

## Question

Can a small crossed model reduce context misattribution with these terms?

- a partially pooled Course mean;
- an Instructor residual after the Course rating is removed;
- a strongly shrunk Course–Instructor interaction;
- enrollment and team-teaching deviations as Course Offering context;
- one shared evidence allocation across a teaching team.

## Run

Use a local directory that contains the pinned Hugging Face files.

```sh
cd data
node prototypes/course-instructor-offering.ts \
  D:/Temp/ust-rankings-167-data \
  D:/Temp/ust-rankings-crossed
```

The command writes:

- `crossed-model.json`;
- `crossed-model-demo.html`.

The HTML file is a small interactive state demo. It has guided views for Course Offering context, Instructor effects, team teaching, and validation limits.

## Sources

- Catalog: `fd704a74bfc9fd9076680da3d80d0a7e304c7164`
- Schedule: `8710e83979c989401aab91972234659adbeaba0a`
- UST Space: `1069ca3822f00da12a22fee8f7ea4fc87dfe8344`
- SFQ: `880e90dbd3af759e1e91c85a1bb721197a79bd8d`

The run used 28,130 aggregated Instructor SFQ rows. Historical ITSC data anchored 27,858 rows. Canonical Schedule data supplied Class context for 8,882 rows. Team-taught Classes supplied 3,433 rows.

## Validation

The prototype selected shrinkage strengths on Terms 94, 95, 96, and 98. It evaluated Terms 99 and 102 after selection.

This split is post hoc. The outcomes existed before the prototype was written. It is not independent confirmation.

Selected strengths:

- Course: 1;
- Instructor: 1;
- Course–Instructor interaction: 4.

## Result

| Comparison | Equal-entity error |
| --- | ---: |
| Course only | 0.332943 |
| Course with Offering context | 0.333453 |
| Raw Instructor history | 0.322138 |
| Course plus Instructor residual | 0.328290 |
| Full crossed model | 0.329871 |

Course Offering context changed Course error by `+0.000510`. Its Course-cluster 95% interval was `[-0.002161, 0.003187]`.

The crossed model changed Instructor error by `+0.007733` relative to raw Instructor history. Its Instructor-cluster 95% interval was `[-0.005769, 0.020512]`.

The prototype did not beat the simpler baselines. Keep production unchanged.

## Local evidence

- JSON SHA-256: `e37495ea4b5292821ea9382baf93794ba69876cc80f9502c9b181d33476ff04f`
- HTML SHA-256: `991a0662eeb93201c9b1fed7b05048037351697e8b191e854e0b7ac0efdf0f1c`
- Browser screenshots were checked for the Course, Instructor, and team-teaching views.
