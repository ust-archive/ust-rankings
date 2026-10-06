# Draft: Waitlist association and component grain

This proposal addresses audit A10 (2026-10-05). It needs a product and evidence-grain decision before release. It does not change model weights, timing, production statistics, model version, or published Delivery artifacts.

## Proposed immediate behavior

Current component ordinals are zero-based within the selected Class's association and normalized Class type, ordered by Section. Historical bundles already group trajectories by Course, Term, and association; their ordinals use that same ordering. This fixes the mismatch where selecting the second LEC across different associations requested historical ordinal 1 even though each historical association contained only ordinal 0.

The immutable Schedule revision `f9632eceb9751da775079efb472c6ba80d03be11` has 60 current LANG 1402 TUT Classes in 60 distinct associations. Selecting a later TUT must therefore use association-local ordinal 0. The regression uses that real shape with synthetic labels and known outcomes, rather than embedding a production outcome fixture.

Numeric association IDs partition Classes inside one Course Offering. They are not treated as stable identifiers across Terms and are not compared for equality between a current and historical offering. A historical association with ID 900 can supply evidence for a current association with ID 2 when their selected component types and ordinals are comparable.

## Mixed-association Waitlist Plans

The draft returns `mixed-association` with an explicit unsupported explanation when required Classes span associations, including known and missing associations together. It does not independently predict their queues and multiply the marginal estimates. Same-association Plans continue using AND outcomes: every selected queue must have enough reduction.

User decision before release: accept this fail-closed scope while retaining existing association-level historical samples, or first implement whole-Course-Offering historical regrouping. The latter must evaluate selected Classes across associations together within the same historical Term and count that joint offering once. It needs a defined structural mapping for associations across Terms; matching numeric IDs would silently assume stability that the archive does not establish.

## Matching and alternatives

The patch preserves the existing matching policy: normalized Class type plus association-local ordinal; Section labels order Classes and identify the user's Class but are not exact cross-Term matching keys. Course and Season define local matching levels; timing buckets, the broader same-pattern prior, and sparse-history smoothing retain their current semantics. It does not add fuzzy Instructor, meeting, capacity, Section-name, or association-ID matching.

An association with additional Classes is still comparable when all selected type/ordinal components exist. This retains historical comparability for existing supported Plans. Missing associations remain one offering-level group, as today; they are not inferred from nearby labels.

Alternatives deferred:

- Whole-offering global ordinals: smaller code change, but discards the current association structure and changes the meaning of repeated Class types.
- Whole-offering association-local ordinals plus ordered association ranks: supports mixed Plans, but the ordering is an additional cross-Term comparability assumption requiring review and real-history validation.
- Exact Section or numeric association-ID matching: can reject renamed yet comparable Classes or match unrelated queues after identifier reuse.

Existing association-level samples can count more than one association from one historical Course Offering. This draft preserves that behavior; it does not claim those samples are independent whole-offering observations. The regrouping option must explicitly revisit sample counts and uncertainty, not merely adjust the current ordinals.

## Verification and release gate

Fast tests exercise the shared candidate-to-prediction interface: later Classes in the 60-association shape map to ordinal 0; different historical IDs remain comparable; a same-association joint Plan fails when one queue fails even if its lecture succeeds; mixed Plans return unsupported. Application and data type checks verify the worker protocol's new reason.

Before ready status, approve the fail-closed policy or implement/review whole-offering regrouping. Any release that changes historical sample grain or matching semantics also needs an explicit model-version/Delivery compatibility decision and real immutable archive validation. This draft deliberately does not publish or refresh those statistics.
