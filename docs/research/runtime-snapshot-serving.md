# Runtime snapshot serving

Research for [issue #18](https://github.com/ust-archive/ust-rankings/issues/18), verified 2026-08-20.

## Summary

Use a **single, always-on Node.js snapshot service on DigitalOcean App Platform's US$5/month 512 MiB plan**, separate from the contribution database and independently refreshable from the public Hugging Face dataset. On a timer, the service resolves the dataset's immutable commit SHA, downloads all five named Parquet files into a candidate generation, validates hashes, schemas, grains, and smoke queries with DuckDB, then atomically publishes that generation; readers keep using the last-known-good generation if any refresh step fails.

This is simpler and more reliable than making each Vercel function maintain an ephemeral snapshot, and materially safer than DuckDB-Wasm on Cloudflare Workers. The current artifacts total only **25,423,678 bytes (24.25 MiB)**; the three current-ranking files total **1,153,804 bytes (1.10 MiB)**, so whole-generation download and local query is preferable to a more elaborate range/cache layer on the recommended service.

## Evidence from the current system and source pipeline

The deployed app currently refreshes JSON during `prebuild`: `scripts/update-data.mjs` fetches `ratings-course.json` and `ratings-instructor.json` from the legacy data repository, so data freshness is coupled to deployment. The two current JSON blobs are 54,472,859 and 42,873,503 bytes in the data branch (97.35 MB total). [Current updater](https://github.com/ust-archive/ust-rankings/blob/master/scripts/update-data.mjs) · [legacy data tree](https://api.github.com/repos/ust-archive/ust-rankings-data/git/trees/data?recursive=1)

The replacement pipeline is already in this repository under `data/`. It uses DuckDB's primary Node API, emits five Zstandard-compressed Parquet relations, and publishes them daily to `ust-archive/ust-rankings` on Hugging Face. The workflow's commit message begins `update(v0):`, but the dataset currently has no tags and no machine-readable manifest/schema version; `main` is the sole branch. [Pipeline README](https://github.com/ust-archive/ust-rankings/blob/master/data/README.md) · [export SQL](https://github.com/ust-archive/ust-rankings/blob/master/data/sql/30_export.sql) · [publisher workflow](https://github.com/ust-archive/ust-rankings/blob/master/.github/workflows/update-rankings-data.yml) · [dataset refs](https://huggingface.co/api/datasets/ust-archive/ust-rankings/refs)

At inspection time, Hugging Face `main` resolved to commit `0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d`. Its expanded tree reported:

| Artifact | Bytes | Purpose |
| --- | ---: | --- |
| `course-instructors.parquet` | 114,991 | term course/instructor bridge |
| `course-rankings.parquet` | 585,957 | current course snapshot |
| `course-ratings.parquet` | 13,592,685 | longitudinal course mart |
| `instructor-rankings.parquet` | 452,856 | current instructor snapshot |
| `instructor-ratings.parquet` | 10,677,189 | longitudinal instructor mart |
| **Total** | **25,423,678** | **24.25 MiB** |

The Hugging Face dataset API independently reports `usedStorage: 25423678`; its dataset-viewer info reports 759,131 rows and 38,353,568 uncompressed logical bytes. Named-file access at both `resolve/main/...` and `resolve/<commit>/...` returned Parquet content. [dataset metadata](https://huggingface.co/api/datasets/ust-archive/ust-rankings) · [expanded tree](https://huggingface.co/api/datasets/ust-archive/ust-rankings/tree/main?recursive=true&expand=true) · [viewer info](https://datasets-server.huggingface.co/info?dataset=ust-archive/ust-rankings)

Do **not** use the dataset-viewer `/parquet` shard list as the application contract. This repository contains five heterogeneous relations in one default split; the viewer renames them to `0000.parquet` through `0004.parquet` and reports only a merged/common schema. Query the five named files on the dataset's normal `main` branch instead. The viewer remains useful as monitoring evidence (`pending`, `failed`, `partial`), not as the serving interface. [Hugging Face Parquet endpoint documentation](https://huggingface.co/docs/dataset-viewer/parquet) · [this dataset's viewer result](https://datasets-server.huggingface.co/parquet?dataset=ust-archive/ust-rankings)

## Recommended design

### 1. Immutable generation identity

Poll `GET https://huggingface.co/api/datasets/ust-archive/ust-rankings` every 10–60 minutes and read its full `sha`. A full commit SHA—not `main`, update time, ETag, or commit message—is the generation ID. Hugging Face's download API supports commit-pinned revisions and version-aware local caching. [Hugging Face download guide](https://huggingface.co/docs/huggingface_hub/en/guides/download)

Construct every artifact URL with the same accepted SHA:

```text
https://huggingface.co/datasets/ust-archive/ust-rankings/resolve/{sha}/{filename}
```

Never query a mixture of `main` URLs: `main` can advance between requests.

### 2. Stage and validate before publication

A refresh creates a private directory such as `snapshots/{sha}.partial/`, downloads the five allowlisted files, and validates all of them before rename/publication.

Required checks:

1. **Repository metadata:** expected five names exist; size is positive and within configured limits; record the expanded-tree LFS SHA-256 and size for each file.
2. **Transport/content:** enforce HTTPS, successful status, exact byte count, SHA-256 equal to the tree's LFS `oid`, and Parquet `PAR1` header/footer. A truncated or HTML error response must never reach DuckDB as a candidate.
3. **Schema:** run `DESCRIBE SELECT * FROM read_parquet(?)` or `parquet_schema(?)` on each local file and compare required columns and logical types against an application-owned `schemaMajor = 0` contract. Reject missing, renamed, narrowed, or incompatible fields. Permit explicitly reviewed additive columns; do not silently coerce incompatible types. DuckDB documents both schema inspection and direct Parquet reads. [DuckDB Parquet documentation](https://duckdb.org/docs/current/data/parquet/overview.html)
4. **Relational invariants:** ensure every relation is non-empty; keys are unique at the documented grains; ranking files contain one `term_num`; their term is the maximum matching history term; `criterion` is non-null; activity flags are Boolean; ranking measures are finite where required; and bridge rows are unique. The source contract defines grains and joins. [Pipeline specification](https://github.com/ust-archive/ust-rankings/blob/master/data/SPECIFICATION.md)
5. **Smoke queries:** execute representative course list, instructor list, detail history, and bridge join queries with row/time limits. Reject a candidate on any DuckDB exception or invariant violation.

The producer should eventually add `manifest.json` containing `schemaMajor`, producer version, source revisions, created time, artifact byte counts/SHA-256, row counts, schemas, and latest term. Until then, the consumer-owned v0 schema plus the Hugging Face commit/tree is sufficient and fail-closed. A commit message containing `v0` is informative, not a contract.

### 3. Atomic activation and stale fallback

After successful validation, rename the complete directory to `snapshots/{sha}/`, then atomically replace a tiny local pointer (write `current.json.tmp`, `fsync`, rename). Keep the previous accepted generation. Each request captures the pointer once and uses only that immutable directory for its entire query.

Refresh errors—Hub timeout/429/5xx, metadata inconsistency, checksum mismatch, disk full, malformed Parquet, schema mismatch, invariant failure, DuckDB error—must:

- leave the pointer unchanged;
- continue serving the last-known-good (LKG) generation;
- expose `snapshotSha`, `snapshotCreatedAt`, `acceptedAt`, `lastAttemptAt`, `lastErrorClass`, and staleness in health/metrics;
- retry with capped exponential backoff and jitter, while normal polling continues.

Ship one validated seed generation in the service image. It makes a cold replacement useful even when Hugging Face is temporarily unavailable. If neither seed nor LKG validates, fail readiness and return `503` with `Retry-After`; never fall through to partial/new data. Alert when age exceeds 48 hours, but keep serving stale data unless product policy sets a hard maximum.

### 4. Concurrency

Use one process-wide refresh promise/mutex (single-flight). A second timer/request joins or skips the active refresh. The US$5 App Platform plan does not horizontally scale, which avoids distributed locking.

Readers do not take the refresh lock. They acquire a generation handle, query immutable Parquet files, and release it. Retire an old directory only after its active-reader count reaches zero (or retain the last two generations and delete later). This prevents deletion or pointer races during long queries.

Use a small DuckDB connection pool on one in-process instance, set `threads = 1`, a conservative memory limit, query timeout/cancellation, result-row cap, and bounded queue. DuckDB is in-process and supports concurrent work within one process; this design performs no database-file writes. [DuckDB concurrency](https://duckdb.org/docs/current/connect/concurrency.html) · [Node.js primary client](https://duckdb.org/docs/current/clients/node_neo/overview.html)

### 5. Query and response caching

Query local Parquet directly; do not ingest it into the contribution database and do not copy it into a DuckDB database file. DuckDB pushes projections and filters into Parquet. It can also range-read Parquet over HTTPS, but whole-generation local download is simpler at 24.25 MiB and bounds upstream dependence to refreshes rather than user requests. [DuckDB HTTP partial reads](https://duckdb.org/docs/current/core_extensions/httpfs/https.html)

Normalize and validate the public query shape, allowlist filter/sort columns, bind values as parameters, and impose pagination/max rows. Cache only serialized public results in a bounded in-memory LRU keyed by:

```text
{acceptedSha}:{normalizedQueryHash}
```

A generation change naturally misses without unsafe global invalidation. Public GET responses should emit an ETag containing the generation and query hash plus a modest CDN policy such as `public, s-maxage=300, stale-while-revalidate=86400`. Include the accepted SHA/age in the response metadata so stale operation is observable.

## Runtime comparison

| Runtime | Fit | Constraints and simplest safe form |
| --- | --- | --- |
| **DigitalOcean App Platform, one Node service** | **Recommended** | US$5/month provides 1 shared vCPU, 512 MiB RAM, 50 GiB transfer. Local FS is 4 GiB but ephemeral and per-instance; use one non-scaling instance, two local generations, and a seed generation in the image. This is enough for 25.4 MB of artifacts and isolates snapshot lifecycle from frontend deployment. [pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) · [filesystem](https://docs.digitalocean.com/products/app-platform/how-to/store-data/) |
| DigitalOcean + Spaces | Stronger optional durability | If a Spaces subscription already exists, mirror accepted immutable generations and an LKG pointer there after validation. This removes dependence on an old image seed after container replacement, but introduces object-store credentials and pointer/conditional-write logic. App Platform officially recommends Spaces for persistent files. Do this only when the selected topology already includes Spaces. |
| Vercel Node/Next.js | Viable, not simplest | Native DuckDB must be externalized/tested in the Linux function bundle. Functions have read-only FS plus 500 MB `/tmp`; Fluid Compute may run concurrent requests in one shared instance. `/tmp`, process globals, and default runtime caches are opportunistic, not a shared LKG. Next 16 says default runtime cache is per-instance/ephemeral and even remote cache entries are build-ID/deployment scoped. A reliable design therefore needs an external accepted-generation pointer/object store or queries the recommended snapshot service. [Vercel runtimes](https://vercel.com/docs/functions/runtimes) · [Fluid concurrency](https://vercel.com/docs/fluid-compute) · [Next cache storage](https://nextjs.org/docs/app/getting-started/caching) · [native package externalization](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) |
| Vercel with cached query results | Useful second layer only | `use cache`/tagged fetch can cache serialized query results and `revalidateTag(tag, "max")` gives stale-while-revalidate, but it is not the authoritative artifact/LKG mechanism and does not survive build-ID changes. [Next revalidation](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) |
| Cloudflare Workers | Reject for direct DuckDB serving | Native `@duckdb/node-api` bindings cannot run in the isolate. DuckDB-Wasm would share a 128 MB isolate limit across concurrent requests, has no threads, faces 3 MB compressed Worker size on Free/10 MB Paid, and WASI remains experimental. Workers are excellent as CDN/proxy in front of the Node service, not as this Parquet query engine without a dedicated prototype. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Wasm](https://developers.cloudflare.com/workers/runtime-apis/webassembly/) · [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) |
| DigitalOcean Droplet | Technically robust, more operations | Persistent VM disk makes LKG trivial and remains within the broad low-cost family, but patching, process supervision, TLS, backups, and recovery are unnecessary operational scope when the App Platform seed/LKG pattern suffices. [Droplet pricing/billing](https://docs.digitalocean.com/products/droplets/details/pricing/) |

## Failure behavior matrix

| Failure | Behavior |
| --- | --- |
| Metadata endpoint timeout/429/5xx | Keep LKG; backoff/jitter; health degraded, not unready |
| `main` advances during refresh | Harmless: all downloads use the initially resolved full SHA |
| Missing/extra unexpected artifact | Reject candidate; keep LKG |
| Size/hash mismatch or interrupted download | Delete `.partial`; keep LKG |
| Unsupported schema major/type change | Reject candidate and alert for consumer release |
| Semantic/grain/smoke-query failure | Reject the entire generation; never mix files |
| Concurrent refresh ticks | Single-flight join/skip |
| Query during activation | Request retains old immutable generation; new requests use new pointer |
| DuckDB query timeout/OOM-risk/invalid public query | Cancel/reject that request; cap queue/results; generation remains healthy |
| Local disk full | Preserve current/LKG first; remove abandoned partials/old retired generations; refresh fails closed |
| Process/container replacement | Validate image seed, serve it, then refresh; optionally restore newer LKG from Spaces |
| No valid seed/LKG | Readiness false; `503 Retry-After` |

## Decision and implementation boundary

Adopt the dedicated one-instance App Platform service as the baseline for the later runtime/query-interface and hosting-topology tickets. Its API should expose only the normalized rankings query contract and health metadata; contribution writes remain in their own datastore. Keep Cloudflare/Vercel caching as optional front layers, not owners of snapshot correctness.

This ticket should not implement the service, alter the Wayfinder map, choose the final whole-site topology, or redesign ranking identities/query semantics. Those remain with the dependent tickets.

## Sources

### Kept

- [Hugging Face dataset API](https://huggingface.co/api/datasets/ust-archive/ust-rankings) and [expanded tree](https://huggingface.co/api/datasets/ust-archive/ust-rankings/tree/main?recursive=true&expand=true) — actual revision, names, sizes, and LFS hashes.
- [Pipeline README](https://github.com/ust-archive/ust-rankings/blob/master/data/README.md), [specification](https://github.com/ust-archive/ust-rankings/blob/master/data/SPECIFICATION.md), [export SQL](https://github.com/ust-archive/ust-rankings/blob/master/data/sql/30_export.sql), and [publisher workflow](https://github.com/ust-archive/ust-rankings/blob/master/.github/workflows/update-rankings-data.yml) — primary artifact contract and publication behavior.
- [Hugging Face download guide](https://huggingface.co/docs/huggingface_hub/en/guides/download) and [viewer Parquet docs](https://huggingface.co/docs/dataset-viewer/parquet) — commit pinning/version-aware cache and limits of the viewer interface.
- [DuckDB Parquet](https://duckdb.org/docs/current/data/parquet/overview.html), [HTTP](https://duckdb.org/docs/current/core_extensions/httpfs/https.html), [concurrency](https://duckdb.org/docs/current/connect/concurrency.html), and [Node API](https://duckdb.org/docs/current/clients/node_neo/overview.html) — runtime compatibility and query behavior.
- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) and [storage](https://docs.digitalocean.com/products/app-platform/how-to/store-data/) — selected runtime's cost and ephemeral filesystem constraints.
- [Vercel runtimes](https://vercel.com/docs/functions/runtimes), [Fluid Compute](https://vercel.com/docs/fluid-compute), and [Next.js cache storage](https://nextjs.org/docs/app/getting-started/caching) — `/tmp`, concurrency, and deployment/cache boundaries.
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Wasm support](https://developers.cloudflare.com/workers/runtime-apis/webassembly/) — memory, bundle, threading, and WASI constraints.

### Dropped

- SEO hosting comparisons and third-party DuckDB deployment posts — excluded in favor of first-party documentation.
- Hugging Face dataset-viewer merged schema as an artifact schema authority — heterogeneous named relations make that representation unsuitable.
- The legacy `ust-rankings-data` repository as the new snapshot producer — retained only to measure the existing JSON baseline; the new primary pipeline lives under this repository's `data/` directory.

## Gaps and residual uncertainty

- No native DuckDB/Vercel packaging or DuckDB-Wasm/Workers load test was run; both remain prototype questions if the hosting ticket rejects the recommended service.
- The dataset lacks `manifest.json`, formal schema-major metadata, and an explicit retention/SLA policy. Consumer-side v0 validation is therefore required until the producer adds them.
- Exact query latency, memory high-water mark, and best DuckDB pool size need a prototype using production query shapes; 512 MiB appears ample from artifact sizes but is not a benchmark.
- Direct HTTP range behavior was established from DuckDB's official support and successful Hugging Face artifact access, but request-count/byte-range traces against Hugging Face were not captured. The recommended whole-download refresh does not depend on per-query range efficiency.
- The image seed becomes older across long periods without service deployment. Use Spaces for the latest accepted generation if recovery from a simultaneous container replacement and Hugging Face outage requires a tighter stale bound.
