---
license: other
pretty_name: UST Rankings
---

# UST Rankings

Daily course and instructor rating marts for UST Rankings, built from the
[`ust-archive`](https://huggingface.co/ust-archive) datasets.

| File                          | Contents                                               |
| ----------------------------- | ------------------------------------------------------ |
| `course-ratings.parquet`      | Longitudinal course ratings by term and criterion.     |
| `instructor-ratings.parquet`  | Longitudinal instructor ratings by term and criterion. |
| `course-rankings.parquet`     | Latest-term course ratings.                            |
| `instructor-rankings.parquet` | Latest-term instructor ratings.                        |
| `course-instructors.parquet`  | Course-to-instructor associations by term.             |

The source pipeline and field documentation are maintained in
[`ust-archive/ust-rankings`](https://github.com/ust-archive/ust-rankings/tree/master/data).
