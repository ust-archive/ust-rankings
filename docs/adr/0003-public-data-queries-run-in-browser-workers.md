# Public data queries run in browser workers

UST Rankings will move public Catalog, Ranking, Instructor identity, and Schedule queries from the DigitalOcean application service into DuckDB-Wasm Web Workers. This keeps the 512 MiB application container focused on accounts and community contributions, removes its native DuckDB query workload, and uses client capacity for public analytical reads. The accepted prototype showed exact sampled ranking parity, a 9.8 MiB browser delivery, sub-second-to-1.4-second cold queries, and millisecond warm queries across Chromium, Firefox, and WebKit.

The full-fidelity source datasets remain canonical archives on Hugging Face. Each publication derives two artifacts with one generation identity: a public, column-pruned **Delivery Dataset** mirrored to DigitalOcean Spaces CDN, and a compact **Server Index** loaded into application memory for authoritative community-write validation. The publisher activates the Server Index before promoting the matching Delivery Dataset. A browser resolves the latest manifest once per tab, pins that immutable generation, preloads only Catalog and Instructor identity data, and fetches Ranking and Schedule Parquet ranges lazily.

There is no server query fallback. If WebAssembly, the Worker, or dataset access fails, static identity and community information remain available while Rankings and Schedule are marked unavailable. Existing calendar subscription delivery is removed temporarily because calendar clients cannot execute the browser runtime. Immutable generation files are retained so tabs and rollbacks can continue using older generations.

## Considered options

- Keeping native DuckDB in the service retained centralized behavior but continued the memory and compute pressure that motivated this change.
- Edge query compute moved cost rather than removing public query compute and introduced another runtime target.
- Downloading the complete dataset eagerly exceeded the initial-route budget; immutable, route-specific range reads preserve the complete generation without paying its full transfer cost at startup.
- Serving browser artifacts directly from Hugging Face exposed anonymous users, especially users behind a shared university IP, to resolver rate limits. Spaces CDN uses the already-paid object-storage allowance while Hugging Face remains canonical.
