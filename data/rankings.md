# Ranking generations

A Ranking Generation is the immutable, full-fidelity Hugging Face archive of
Course, rating, association, and Instructor identity Parquet relations. The
`data` workspace owns its native DuckDB build and validation tooling. The
application service does not download or query these Parquet files.

Each publication preserves Instructor UUIDs and append-only identity history
from the previous identity-aware Ranking Generation. Missing identity artifacts
or unresolved source identities fail publication rather than minting a parallel
registry. An intentional first identity-history publication may use
`npm run run -- --init`; Instructor identities and aliases remain required. TBA
is never an identity.

## Browser delivery

The publisher pins the Ranking and Schedule source revisions, then derives one
paired browser Delivery Dataset and Server Index. The Delivery Dataset retains
the complete user-facing Ranking history with browser-only columns and is
queried through the typed browser Worker API. Pages never issue SQL or call a
server Ranking fallback.

The Server Index carries canonical Instructor identity, redirects, scoped
corrections, Course–Instructor relations, Course Offerings, and Classes needed
for static identity and contribution validation. The service verifies and
activates it before the matching Delivery manifest becomes latest. If the
browser Worker or CDN is unavailable, static identity and Community remain
usable while Rankings report an unavailable state.

See [`../docs/data-pipeline.md`](../docs/data-pipeline.md) for publication,
activation, and paired rollback.
