# Waitlist queue-evidence prototype

**Question:** Can aggregate UST Class history provide useful queue evidence without claiming to know an individual student's enrollment outcome?

Generated directly from the unified [Schedule dataset](https://huggingface.co/datasets/ust-archive/schedule) view, with hard-coded dates from confirmed HKUST Registry PDFs.

Schedule source revision: **4141444eacd731e36fcc4c09f29efb216f500658**. DuckDB pre-computes changed observations, trajectory features, and movement outcomes; JavaScript indexes the resulting counts for the held-out aggregation and formats this report.

## Data coverage

| Term | Season | Normal enrollment start | Add/drop end | Class trajectories | Ever waitlisted |
| --- | --- | --- | --- | ---: | ---: |
| 2410 | Fall | 2024-08-27 | 2024-09-14 | 2988 | 1761 |
| 2430 | Spring | 2025-01-23 | 2025-02-15 | 3065 | 1598 |
| 2510 | Fall | 2025-08-26 | 2025-09-13 | 5795 | 1828 |
| 2530 | Spring | 2026-01-27 | 2026-02-14 | 5754 | 1605 |

- Total trajectories: **17602**
- Ever waitlisted: **6792**
- Alignment: hours since normal enrollment start, hours since Queue Activation, and time until add/drop (nearby timing buckets are pooled); positive waits before normal enrollment are baseline occupancy
- Enrollment before the official start is treated as baseline occupancy, not Queue Activation

## Time-based model challenge

Every 2025–26 outcome is predicted only from earlier Terms. Tuning covers queue positions 5, 25, 50 at 12, 24, 48 hours after Queue Activation. Each position/time cell contributes equally. Prior weight is selected from 0.5, 1, 2, 4, 8, 16, 32 by mean held-out Brier score; lower is better.

| Candidate matching | Prior weight | Brier | Local-match coverage | Decision |
| --- | ---: | ---: | ---: | --- |
| global | 32 | 0.2144 | 8870/8872 | Reject |
| baseline | 4 | 0.2026 | 5549/8872 | Retain |
| capacity | 4 | 0.2026 | 5549/8872 | Reject |
| instructor | 2 | 0.2062 | 3737/8872 | Reject |
| meeting | 4 | 0.2117 | 1480/8872 | Reject |
| all | 4 | 0.2120 | 895/8872 | Reject |

The retained candidate is **baseline**. Global uses only the timing-aligned same-type prior; baseline adds Course/type matching. Capacity includes quota-to-venue utilization and the presence of reservations. Instructor and meeting time are retained only if their held-out score wins; otherwise they remain details, not predictors.

Prior-strength tuning for the retained candidate:

| History-equivalent weight | Mean Brier |
| ---: | ---: |
| 0.5 | 0.2128 |
| 1 | 0.2065 |
| 2 | 0.2030 |
| 4 | 0.2026 |
| 8 | 0.2045 |
| 16 | 0.2070 |
| 32 | 0.2092 |

This tuning is provisional: Fall 2026 remains incomplete and is reserved as the next untouched evaluation Term. The single-Class diagnostic grid may select a different weight; the shared production prior remains frozen at **2**.

## Joint Waitlist Plan demonstration

The joint model groups required Classes from one historical Course Offering before calculating outcomes. A favorable sample requires every selected component to clear its own position; marginal component percentages are never multiplied.

- Historical component pattern: **LAB+LEC**
- Joint headline for position 25 on each component: **47% ±41 pp (6–88%)**
- Exact Course-Offering histories: **1** (0 favorable); broader same-pattern histories: **27** at **70%**
- Separate Queue Activation clocks are used for each component after normal enrollment; Section labels remain identifiers only.
- Joint smoothing calculation: `(0 + 2 × 0.704) ÷ (1 + 2) = 0.469`.
- Self-check favorable plan: LEC position 20 + LAB position 5 is favorable. Self-check failed plan: the same LEC position 20 + LAB position 11 is not favorable, because AND semantics require both components to clear.

| Candidate matching | Prior weight | Brier | Local-match coverage | Decision |
| --- | ---: | ---: | ---: | --- |
| global | 32 | 0.2074 | 3575/3592 | Reject |
| baseline | 2 | 0.2009 | 1519/3592 | Retain |
| capacity | 2 | 0.2009 | 1519/3592 | Reject |
| instructor | 2 | 0.2016 | 1062/3592 | Reject |
| meeting | 2 | 0.2054 | 208/3592 | Reject |
| all | 2 | 0.2054 | 190/3592 | Reject |

The production joint candidate is **baseline** with frozen prior weight **2**. The held-out grid's best baseline weight is **2**; changing production parameters requires a repeatable refresh. Exact smoothing is independent of the single-Class provisional result above.

## Demonstration: HUMA 1710 L1, position 25

Current Schedule snapshot (2026-08-27T08:31:39.712Z):

- Queue Activation first observed: **2026-08-25T13:01:28.560Z**
- Time since Queue Activation: **43.5 hours**
- Normal UG enrollment started: **25 August 2026**
- Add/drop ends: **14 September 2026**
- Capacity / enrolled / waitlisted: **80 / 71 / 236**
- Venue: **Rm 2407, Lift 17-18 (126)**, physical capacity **126**
- Reserved quota: **21/30 enrolled**

> **Historical queue evidence: 78% ±34 pp (44–100%)**
> Estimated uncertainty width: **56 percentage points**
> Exact histories: **1** (1 favorable); broader LEC histories: **1030** at **67%**
> Broader-prior influence: **2-history equivalent**; this is not the student's enrollment probability.

### Capacity scenarios

| Scenario | Additional physical/general headroom | Position-25 interpretation |
| --- | ---: | --- |
| No quota expansion | 0 currently available general seats | Requires drops or reservation release |
| Expand to current venue (126) | Up to 46 additional seats | Capacity arithmetic could cover position 25, but expansion is not promised |
| Repeat last year's larger-venue outcome (354) | Up to 274 additional seats | Historically possible, not a forecast |

Last Fall, the deadline snapshot had capacity **354**, wait **105**, venue ceiling **unknown**, and reservation quota **0**. A venue-driven quota increase materially changed that queue, so capacity paths belong in the evidence rather than being dismissed as noise.

<details>
<summary>How the headline was formed</summary>

- Exact matching: same Course, Class type, and Season; then same Course and Class type.
- Raw exact outcomes: 1/1 had net queue reduction of at least 25.
- Exact net reductions: 327.
- Exact observed exits: 394.
- Sparse exact evidence is shrunk toward the broader same-type rate using production prior weight 2; it is never displayed as an unsupported raw 0% or 100%.
- Headline calculation: `(1 + 2 × 0.669) ÷ (1 + 2) = 0.779`.
- The ± value is an estimated uncertainty margin; the explicit range is capped to 0–100% and may therefore be asymmetric.
- Net reduction and observed exits are diagnostics, not mathematical probability bounds.

</details>

## Verdict

The prototype always returns a transparent historical-evidence estimate, but release still requires the retained model to beat simpler alternatives consistently across Terms and queue positions. Reservation eligibility is not requested because the archive cannot calibrate subgroup outcomes. Official dates remain a checked static table until unsupported Terms justify a feed integration.
