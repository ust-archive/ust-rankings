# Schedule runtime generation

Development and production lazily download the immutable
`ust-archive/schedule` Hugging Face generation into the operating system's
temporary directory. Tests install generated fixture generations through the
Schedule runtime reset helper and remain offline.

The manifest records the two required Parquet files' LFS SHA-256 digests and
sizes. Schedule data keeps Instructor source names only; the server resolves
exact matches against the accepted Ranking Generation at read time and leaves
all other source names unresolved plain text. The server-only Schedule module
revalidates framing, hashes, schemas, source event grains, Term relationships,
and representative queries before serving the generation.

## Refresh and retention

`GET /api/schedule/refresh` performs the authenticated daily refresh. A manual
or upstream-triggered `POST` may supply one full commit SHA. Both files are
resolved from that single immutable `ust-archive/schedule` commit, bounded,
checked against their LFS declarations, validated together, written under the
operating system's temporary directory, and only then made active.
PostgreSQL advisory lock `(1431520338, 40)` excludes concurrent Schedule
refreshes independently of the ranking lock.

The local `active.json` pointer retains the previous accepted SHA. A failed
refresh records only a bounded failure class, leaves that pointer unchanged,
and keeps the in-memory generation if one is already accepted. There is no
repository generation or shared last-known-good across instances: Hugging Face
is the source of truth. The process warms from Hugging Face on `next start` and again
daily. Schedule stays unavailable until a generation is accepted. The temporary
generation directory is only a disposable per-instance cache. Schedule cache
identities, freshness, and failure records never reuse ranking keys.

Configure `POSTGRES_URL`, `CRON_SECRET`, and optional `SCHEDULE_REFRESH_SECRET`
as shown in `.env.example`. Public `GET /api/health/schedule` reports
non-sensitive freshness and bounded failure classes without exposing storage
paths or credentials.

## Public planner state

`/schedule` keeps public planner state in `term`, bounded `q`, repeated
sorted/deduplicated `class`, and `view` query values. Add, remove, search, view,
and SIS-import actions produce the same shareable URL without authentication or
server-side User state. Incoming state is replaced with its canonical URL after
validation, and the cart is capped at 50 Classes without discarding an existing
valid selection. Changing or supplying an invalid Term clears selected Classes
so a Class Number reused in another Term cannot select a different Class.
