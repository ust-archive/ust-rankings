# Schedule runtime seed

`schedule/seed/0ddb2e493caeeb8aa9c56728496c866c358a2431` is the
validated cold-start Schedule generation from the immutable
`ust-archive/schedule` Hugging Face commit with that SHA.

The manifest records the two required Parquet files' LFS SHA-256 digests and
sizes. It also carries only exact, unambiguous source-name associations to the
durable Instructor UUID registry shipped with the ranking seed; all other
source names remain unresolved plain text. The server-only Schedule module
revalidates framing, hashes, schemas, source event grains, Term relationships,
and representative queries before serving the generation.

Set `SCHEDULE_SEED_DIR` to a commit-named generation directory for isolated
local validation and tests.

## Refresh and retention

`GET /api/schedule/refresh` performs the authenticated daily refresh. A manual
or upstream-triggered `POST` may supply one full commit SHA. Both files are
resolved from that single immutable `ust-archive/schedule` commit, bounded,
checked against their LFS declarations, validated together, persisted below
private immutable `schedule/generations/{sha}/` Space keys, and only then made
active. PostgreSQL advisory lock `(1431520338, 40)` excludes concurrent
Schedule refreshes independently of the ranking lock.

The private `schedule/active.json` pointer retains the previous accepted SHA.
A failed refresh records only a bounded failure class, leaves that pointer
unchanged, and continues serving the last-known-good generation. Each instance
revalidates a downloaded generation and falls back from active to previous to
the shipped seed. `/tmp/ust-schedule/{sha}` is only a disposable per-instance
cache. Schedule cache identities, freshness, and failure records never reuse
ranking keys.

Configure the `SCHEDULE_SPACE_*`, `POSTGRES_URL`, `CRON_SECRET`, and optional
`SCHEDULE_REFRESH_SECRET` values shown in `.env.example`. Keep the Space and
objects private and grant the runtime only the required object access. Public
`GET /api/health/schedule` reports non-sensitive freshness and bounded failure
classes without exposing provider details or credentials.

## Public planner state

`/schedule` keeps public planner state in `term`, bounded `q`, repeated
sorted/deduplicated `class`, and `view` query values. Add, remove, search, view,
and SIS-import actions produce the same shareable URL without authentication or
server-side User state. Incoming state is replaced with its canonical URL after
validation, and the cart is capped at 50 Classes without discarding an existing
valid selection. Changing or supplying an invalid Term clears selected Classes
so a Class Number reused in another Term cannot select a different Class.

## Calendar feeds

Selected Classes use the canonical public
`/schedule/calendar.ics?term=2510&class=1001&class=1002` feed. Requests require
exactly one valid Term Code and resolve every deduplicated Class Number through
the Schedule module; any invalid or missing Class rejects the whole feed. The
same path works with `webcal://`, defaults to inline subscription/opening, and
adds download disposition only with `download=1`.

Calendar UIDs use each Class meeting's recurrence slot (weekday, date range,
and time range) as the durable meeting identity, so source ordering and mutable
room or Instructor details do not change identity. Hong Kong Schedule values
are converted explicitly to UTC, and ETags bind the complete emitted calendar,
normalized request, and accepted Schedule generation. Established
`/api/calendar?term=2510&number=1001` subscriptions remain supported by the
same generator.
