# Deferred validation and identity work

These changes are intentionally deferred. The current model remains the
production model until an experiment shows that a replacement performs better.
The validation must reuse the production SQL semantics rather than a simplified
copy of the calculation.

## 1. Walk-forward backtest

For each historical cutoff term, calculate ratings using only the information
that would have been available through that term, then compare those estimates
with feedback received in later terms.

Use the backtest to evaluate, rather than assume, the model's main constants and
weighting rules:

- annual time-decay base (`0.65`);
- current-instructor course multiplier (`12`);
- linear review vote confidence;
- SFQ response-count and response-rate confidence.

Compare candidates using prediction error, ranking stability, and uncertainty
calibration. Keep the current value when an alternative does not produce a
clear, repeatable improvement.

The test must distinguish two historical meanings:

- **retrospective history:** today's latest record state recalculated for an old
  term;
- **as-of history:** only record versions, votes, edits, and deletions known at
  that historical cutoff.

The current output is retrospective. An as-of backtest requires source event
history and must not silently use later edits or vote totals.

## 2. Confidence and uncertainty model

Test whether contextual relevance and statistical confidence should be treated
separately. The current course multiplier affects both the weighted score and
its confidence, even though a relevant observation does not contain more
respondents merely because its instructor matches the output term.

Candidate experiment:

1. Keep contextual weighting when calculating the course estimate.
2. Calculate uncertainty from independent evidence volume and source precision.
3. Evaluate SFQ standard deviations and respondent counts as estimates of
   measurement error after confirming that the fields are comparable across
   SFQ versions.
4. Compare posterior calibration and held-out prediction performance with the
   current model.

Do not change the production formula unless the walk-forward results show a
material improvement and the chosen interpretation remains understandable to
downstream users.

## 3. Stable instructor identity

The clustered canonical `name` is currently both the display label and public
join key. This deliberately avoids inventing an opaque name-derived ID, but it
has two known limits:

- two different people with the same canonical name are merged;
- a cluster's key can change between snapshots when a newly available schedule
  spelling becomes its preferred name.

Do not grow a list of special-case name rules to hide these limits. Revisit the
identity contract when an upstream dataset provides a durable person ID. At
that point, preserve the canonical name as a display field and migrate joins to
the upstream identifier.

## Completion criteria

- The backtest calls or shares the same SQL logic as production.
- Every candidate is evaluated over multiple cutoff terms.
- Results include baseline comparisons and sensitivity to sparse evidence.
- The selected parameters and uncertainty formula are recorded with the build.
- Any model change includes focused regression fixtures and updated
  documentation.
