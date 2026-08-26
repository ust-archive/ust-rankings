# Waitlist queue-evidence prototype

**Question:** Can aggregate UST Class history provide useful queue evidence without claiming to know an individual student's enrollment outcome?

Generated directly from the current and legacy relations in the [Schedule dataset](https://huggingface.co/datasets/ust-archive/schedule), with hard-coded dates from confirmed HKUST Registry PDFs.

## Data coverage

| Term | Season | Normal enrollment start | Add/drop end | Class trajectories | Ever waitlisted |
| --- | --- | --- | --- | ---: | ---: |
| 2410 | Fall | 2024-08-27 | 2024-09-14 | 2988 | 1761 |
| 2430 | Spring | 2025-01-23 | 2025-02-15 | 3065 | 1598 |
| 2510 | Fall | 2025-08-26 | 2025-09-13 | 3204 | 1824 |
| 2530 | Spring | 2026-01-27 | 2026-02-14 | 3161 | 1568 |

- Total trajectories: **12418**
- Ever waitlisted: **6751**
- Alignment: hours since normal enrollment start, hours since Queue Activation, and time until add/drop (nearby timing buckets are pooled)
- Enrollment before the official start is treated as baseline occupancy, not Queue Activation

## Time-based model challenge

Every 2025–26 outcome is predicted only from earlier Terms. Tuning covers queue positions 5, 25, 50 at 12, 24, 48 hours after Queue Activation. Each position/time cell contributes equally. Prior weight is selected from 0.5, 1, 2, 4, 8, 16, 32 by mean held-out Brier score; lower is better.

| Candidate matching | Prior weight | Brier | Local-match coverage | Decision |
| --- | ---: | ---: | ---: | --- |
| global | 0.5 | 0.2114 | 0/8853 | Reject |
| baseline | 4 | 0.2016 | 5516/8853 | Retain |
| capacity | 4 | 0.2048 | 4047/8853 | Reject |
| instructor | 4 | 0.2054 | 3674/8853 | Reject |
| meeting | 4 | 0.2097 | 1644/8853 | Reject |
| all | 4 | 0.2104 | 762/8853 | Reject |

The retained candidate is **baseline**. Global uses only the timing-aligned same-type prior; baseline adds Course/type matching. Capacity includes quota-to-venue utilization and the presence of reservations. Instructor and meeting time are retained only if their held-out score wins; otherwise they remain details, not predictors.

Prior-strength tuning for the retained candidate:

| History-equivalent weight | Mean Brier |
| ---: | ---: |
| 0.5 | 0.2123 |
| 1 | 0.2059 |
| 2 | 0.2021 |
| 4 | 0.2016 |
| 8 | 0.2033 |
| 16 | 0.2057 |
| 32 | 0.2079 |

This tuning is provisional: Fall 2026 remains incomplete and is reserved as the next untouched evaluation Term.

## Demonstration: HUMA 1710 L1, position 25

Current Schedule snapshot (2026-08-26T13:14:44.014Z):

- Queue Activation first observed: **2026-08-25T13:01:28.560Z**
- Time since Queue Activation: **24.2 hours**
- Normal UG enrollment started: **25 August 2026**
- Add/drop ends: **14 September 2026**
- Capacity / enrolled / waitlisted: **80 / 71 / 238**
- Venue: **Rm 2407, Lift 17-18 (126)**, physical capacity **126**
- Reserved quota: **21/30 enrolled**

> **Historical queue evidence: 72% ±31 pp (41–100%)**  
> Estimated uncertainty width: **59 percentage points**  
> Exact histories: **1** (1 favorable); broader LEC histories: **817** at **64%**  
> Broader-prior influence: **4-history equivalent**; this is not the student's enrollment probability.

### Capacity scenarios

| Scenario | Additional physical/general headroom | Position-25 interpretation |
| --- | ---: | --- |
| No quota expansion | 0 currently available general seats | Requires drops or reservation release |
| Expand to current venue (126) | Up to 46 additional seats | Capacity arithmetic could cover position 25, but expansion is not promised |
| Repeat last year's larger-venue outcome (354) | Up to 274 additional seats | Historically possible, not a forecast |

Last Fall, the deadline snapshot had capacity **354**, wait **105**, venue ceiling **354**, and reservation quota **0**. A venue-driven quota increase materially changed that queue, so capacity paths belong in the evidence rather than being dismissed as noise.

<details>
<summary>How the headline was formed</summary>

- Exact matching: same Course, Class type, and Season; then same Course and Class type.
- Raw exact outcomes: 1/1 had net queue reduction of at least 25.
- Exact net reductions: 269.
- Exact observed exits: 402.
- Sparse exact evidence is shrunk toward the broader same-type rate using held-out prior weight 4; it is never displayed as an unsupported raw 0% or 100%.
- Headline calculation: `(1 + 4 × 0.644) ÷ (1 + 4) = 0.715`.
- The ± value is an estimated uncertainty margin; the explicit range is capped to 0–100% and may therefore be asymmetric.
- Net reduction and observed exits are diagnostics, not mathematical probability bounds.

</details>

## Verdict

The prototype always returns a transparent historical-evidence estimate, but release still requires the retained model to beat simpler alternatives consistently across Terms and queue positions. Reservation eligibility is not requested because the archive cannot calibrate subgroup outcomes. Official dates remain a checked static table until unsupported Terms justify a feed integration.
