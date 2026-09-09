# Schedule generations

The immutable `ust-archive/schedule` Hugging Face archive contains the complete
Course Offering and Class event relations. Native DuckDB validation and browser
artifact derivation belong to the `data` workspace; the application service
does not download or query Schedule Parquet.

The publisher derives `schedule-courses.parquet` and
`schedule-classes.parquet` into the paired immutable Delivery Dataset. Schedule
pages and Details query them through the same tab-pinned DuckDB-Wasm Worker used
for Rankings. Instructor source names resolve through the paired identity
relations and scoped corrections. There is no server Schedule fallback.

If Schedule delivery fails, the Schedule section reports an unavailable state
without disabling Rankings or Community. Calendar subscriptions use
`/api/calendar?term=2610&class=2229`: a narrow endpoint that reads precomputed
meeting records from the active Server Index, without querying Schedule Parquet.
Publish a new Delivery Generation containing those records when deploying this
feature; older indices without calendar records return an explicit unavailable
response. The Subscribe dialog checks the feed before offering its URL.

The URL fixes the Term and selected Class Numbers. Calendar apps periodically
fetch that URL and receive meeting updates from the currently active generation,
with the same bundled HKUST holiday exclusions used by downloads. Changing the
cart requires replacing the subscription URL; refresh timing belongs to the
calendar app. See [Schedule calendar exports](../docs/schedule-calendar.md) for
holiday sources, update procedures, and provider limitations.

The planner can download an `.ics` snapshot directly from the selected Classes
in that pinned generation. Calendar generation loads only on demand, preserves
the former recurrence-slot UIDs, and reports meetings that cannot be exported.

## Public planner state

`/schedule` keeps public planner state in `term`, bounded `q`, repeated
sorted/deduplicated `class`, and `view` query values. Add, remove, search, view,
and SIS-import actions produce the same shareable URL without authentication or
server-side User state. Actions produce canonical URLs after validation; an
invalid incoming URL retains its notices and offers an explicit repair for
unknown Classes. The cart is capped at 50 Classes without discarding an existing
valid selection. Changing or supplying an invalid Term clears selected Classes
so a Class Number reused in another Term cannot select a different Class.

See [`../docs/data-pipeline.md`](../docs/data-pipeline.md) for publication and
paired rollback.
