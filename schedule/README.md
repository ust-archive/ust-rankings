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
local validation and tests. Schedule refresh, last-known-good storage, and
health automation are tracked separately by issue #40.
