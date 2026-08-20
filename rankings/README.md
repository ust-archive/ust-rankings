# Runtime ranking seed

The application ships one complete, validated ranking generation under
`seed/<Hugging Face commit SHA>/`. A generation contains exactly the five v0
Parquet relations plus its application-owned `manifest.json`.

The manifest pins the immutable source commit and declares every Parquet file's
SHA-256 and byte size. It also assigns permanent application UUIDs to the
Canonical Instructor Names in that generation. Each source-observed spelling is
retained as an Instructor Alias with its source commit and file provenance. The
registry is append-only: future seed updates must preserve UUIDs when a known
alias or Canonical Instructor Name is observed again. TBA is never an identity.

`lib/rankings/server.ts` validates the filenames, declarations, Parquet framing,
v0 schemas, relation grains, finite measures, latest-Term relationships,
Instructor registry, and representative queries before opening the generation
to `queryRankings` or `getRankings`. A validation failure stays inside the
rankings module and renders the ranking-specific unavailable state.

The included seed is Hugging Face dataset commit
`0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d`. Its declarations come from the
expanded dataset tree, and the committed bytes match that commit's LFS objects.

## Public explorer

`/rankings/courses` and `/rankings/instructors` both call `queryRankings`; pages
never read Parquet directly. Term, activity, search, entity-specific filters,
preset or custom criterion weights, and continuation cursor are represented in
the query string. Cursors bind the accepted generation, normalized query, and
last result, so a replaced generation cannot be mixed into an existing page.

Course titles and current Common Core category labels come from the generated
course catalog refreshed by `bun run update-data` (and by `prebuild`). Ranking
scores and Course–Instructor associations continue to come only from the
validated immutable ranking generation.
