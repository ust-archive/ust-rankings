# Waitlist Evidence operations

Waitlist Evidence presents aggregate Historical Queue Evidence for one Waitlist Plan. It does not estimate an individual student's enrollment probability. Every selected Class is required, and a historical Course Offering is favorable only when all selected component queues show sufficient net reduction.

## Sources and delivery

The data build projects the pinned Schedule archive's `classes_legacy.parquet` into the narrow `waitlist-evidence.parquet` Delivery artifact. The manifest records its hash, size, source revision, model version, timing grid, and tuned prior. The browser query worker pins that generation and fetches the artifact only for a Waitlist Plan calculation. Search uses the already-lazy current Schedule relations. There is no server query fallback.

Section labels identify current and historical Classes but are not predictive features. Queue Activation ignores positive waits observed before normal Class enrollment. The model matches Course, component pattern, Season, and timing, then smooths sparse exact history toward broader same-pattern history. Capacity, reservations, meetings, and Instructors remain diagnostics in version `joint-baseline-v1`.

Queue positions stay in React state and worker messages. They are not placed in URLs, persistent browser storage, analytics payloads, or server requests.

## Official Term dates

Supported Fall/Spring dates and Registry PDF sources live in `data/src/waitlist-evidence.ts` as `WAITLIST_TERMS`. To add a Term:

1. Confirm normal Class enrollment start and ordinary add/drop end in a final HKUST Registry PDF.
2. Add the exact Hong Kong timestamps and PDF URL to `WAITLIST_TERMS`.
3. Add boundary coverage to `data/test/waitlist-evidence.test.ts` and delivery fixtures.
4. Rebuild a pinned Delivery generation. Unknown Terms remain unsupported; do not infer dates from neighboring Terms.

Winter, Summer, consent-required, irregular-deadline, inactive, and non-waitlisted Classes remain unsupported.

## Model refresh and held-out validation

Run the fast deterministic checks first:

```sh
npm test --workspace data -- waitlist-evidence.test.ts
node data/prototypes/waitlist-clearance.ts --self-check
```

After a Term is complete in the pinned Schedule archive, evaluate it without changing production parameters:

```sh
node data/prototypes/waitlist-clearance.ts --validate-term=2610
```

This writes `data/prototypes/waitlist-clearance-validation-2610.md` and fails if the Term has no completed trajectories. The command scores the frozen candidate grid against only that held-out Term; it does not edit `WAITLIST_MODEL_VERSION`, prior weights, or Delivery metadata.

A production parameter change requires repeatable whole-Term Brier improvement without material local-match coverage loss. Update the shared implementation and tests, increment `WAITLIST_MODEL_VERSION`, regenerate the prototype report, rebuild the Delivery artifact, and review the resulting manifest diff. Never update parameters automatically from one completed Term.

## Release checks

```sh
npm run check
npm run test:browser
npm test --workspace data
npm run type-check --workspace data
```

Before release:

- exercise two independent Course cards, filtering restoration, Details, refresh clearing, unsupported data, and worker/artifact failure;
- inspect desktop and 390 px mobile screenshots for overflow, focus, dense Class inputs, and headline readability;
- confirm Course/Instructor Rankings and Schedule work while Waitlist Evidence is unavailable;
- inspect network requests for queue positions;
- confirm Ranking and Schedule routes do not request `waitlist-evidence.parquet`;
- record cold artifact bytes, first-result latency, warm recalculation latency, and Chromium worker heap in the release issue. Local fixtures establish regression mechanics, not production CDN budgets; production measurements govern release decisions.

Physical Safari follows the repository's normal pre-release device check because it is not available in automated CI.
