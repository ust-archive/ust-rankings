# Database usage diagnostics

The application emits version 1 `database-operation` JSON lines to its existing stdout log. No collector, storage service, or database table is required. These events count **database-backed service operation attempts**, not SQL statements, connections, or billed compute. Validation may reject an operation before it issues SQL; a successful operation may execute several statements and include non-database work.

## Coverage and interpretation

Each attempt and completion share a random operation ID. Events contain deployment/build ID, process ID, time, operation, bounded caller, read/write intent, coarse authentication context, request class, and completion duration/outcome. Quota/resource exhaustion with PostgreSQL code `53000`, including wrapped errors, is categorized as `quota-exceeded`; other errors use `other`. Original application errors are preserved. No SQL, arguments, user/entity identifiers, raw URLs, tokens, or arbitrary error messages are included in these events. Existing application and operator logs have their own content; treat raw log exports as private.

Coverage includes all asynchronous methods returned by the production Account, Review, Signals, Moderation, and Attachment service getters. Caller context distinguishes Course, Course Term, Course Section, Instructor, Review, account header, other account work, authentication, attachments, and operators. Synchronous attachment normalization is excluded because it does not access PostgreSQL. Internal repository work is represented by its owning service operation, not logged a second time.

The migration, moderation, Instructor Signals merge, and Stored File removal commands each emit one non-HTTP operation around their work. Capture their terminal/deployment logs as well as web runtime logs when they run during a measurement window. Commands that fail argument/configuration validation before starting work, service initialization failures before an operation starts, third-party database clients, and ad hoc SQL are outside this coverage.

`DEPLOYMENT_ID` can supply a bounded build identifier. Otherwise the Next build ID is read locally once; an unavailable ID becomes `unknown`. Process IDs distinguish restarts and instances. Nothing queries PostgreSQL to collect this metadata.

Request classification uses only available coarse request headers. Full RSC prefetch can omit the prefetch marker, and Next may strip internal headers before service code sees them. Consequently `rsc-unknown` and `unknown` must not be interpreted as deliberate navigation. Authentication is `unknown` where it is not established at the call boundary; public attachment reads and operator work do not imply a signed-in User.

## Capture and summarize

Download the existing App Platform runtime logs during the observation window, including every instance. Runtime retention is not a durable-history guarantee; record known outages, dropped/truncated exports, process restarts, and capture gaps alongside the report. See [DigitalOcean's log instructions](https://docs.digitalocean.com/products/app-platform/how-to/view-logs/) for console, `doctl`, and API access. Do not add a SQL-based heartbeat: it would itself keep the database active.

Run with the project's Node 26 toolchain:

```sh
npm run diagnostics:database -- --from 2026-10-01T08:00:00Z --to 2026-10-02T08:00:00Z runtime.log operator.log
```

The interval is inclusive at the start and exclusive at the end. The command handles JSON lines with a provider prefix, deduplicates overlapping exports by process/operation/phase, and reports attempts, completions, errors, durations, callers, minute buckets, malformed/unsupported records, and unmatched events. It only groups observed minutes; missing minutes are not certified zero-usage periods. The largest observed interval between attempts is **not proof of database inactivity**: an earlier operation can still be running, logs can be missing, and other clients can access the database.

For a billing comparison, capture Neon **control-plane** cumulative usage counters at both boundaries for the same project/branch and billing period. Use the counter values without querying the database. Normalize each snapshot into this small local JSON format, with its actual capture time:

```json
{
  "timestamp": "2026-10-01T08:00:00Z",
  "scope": "project-id/production-branch-id/2026-10",
  "compute_time_seconds": 3600,
  "active_time_seconds": 7200
}
```

```sh
npm run diagnostics:database -- --from 2026-10-01T08:00:00Z --to 2026-10-02T08:00:00Z --usage-before before.json --usage-after after.json runtime.log
```

The command rejects mismatched boundaries/scopes and decreasing counters. The compute delta divided by 3600 is CU-hours; operation durations are not a cost allocation. Inspect available Neon start/suspend history alongside these results. Use comparable traffic windows with both ordinary activity and a quiet period; document reporting delay and unavailable provider history. Remove further waste only when the evidence identifies it. Reassess the plan if ordinary remaining use still exceeds its allowance.

## Prefetch regression

`EntityLink` prepares immutable browser-query data on hover/focus/pointer interaction, but never prefetches the dynamic route. Intentional navigation still executes current Reviews and Signals reads. Community results remain uncached, preserving viewer-specific permissions and immediate moderation visibility.

`npm run test:prefetch` runs Chromium against a separately started **production** build with healthy disposable PostgreSQL and real immutable public Delivery data. It checks Course and Instructor links, anonymous and signed-in contexts, scrolling, hover, keyboard focus and navigation, public dataset preloading, preserved destination parameters, and successful community reads. It observes operations rather than counting new connections. Never point this test server at production Neon.

Preparation in separate terminals (PowerShell):

```powershell
# Disposable localhost database; choose an unused port/container name.
docker run --detach --rm --name rankings-prefetch-pg --publish 127.0.0.1:15438:5432 --env POSTGRES_PASSWORD=local-test --env POSTGRES_DB=diagnostics postgres:18
$env:TEST_CONTRIBUTIONS_POSTGRES_URL = 'postgres://postgres:local-test@127.0.0.1:15438/diagnostics'
node --input-type=module -e 'import { seedBrowserContributions } from "./test/browser-contributions-fixture.ts"; await seedBrowserContributions();'
$env:CONTRIBUTIONS_POSTGRES_URL = "$($env:TEST_CONTRIBUTIONS_POSTGRES_URL)?options=-csearch_path%3Dbrowser_fixture"
$env:AUTH_SECRET = 'local-prefetch-test-secret-not-for-production'
$env:NEXT_DIST_DIR = '.next-preview'
npm run build
# Match the deployed standalone layout, including public and static assets.
New-Item -ItemType Directory -Force .preview | Out-Null
robocopy public .next-preview/standalone/public /E /NFL /NDL /NJH /NJS /NP
robocopy .next-preview/static .next-preview/standalone/.next-preview/static /E /NFL /NDL /NJH /NJS /NP
$env:HOSTNAME = '127.0.0.1'
$env:PORT = '17839'
node .next-preview/standalone/server.js *> .preview/prefetch-runtime.log
```

In another terminal:

```powershell
$env:PREFETCH_BASE_URL = 'http://localhost:17839'
$env:PREFETCH_RUNTIME_LOG = '.preview/prefetch-runtime.log'
$env:PREFETCH_AUTH_SECRET = 'local-prefetch-test-secret-not-for-production'
npm run test:prefetch
```

The test preserves the real Delivery manifest (including source revisions) and screenshots as Playwright artifacts. It does not generate or substitute public browser fixtures. Stop the local server and remove only the named disposable container afterward (`docker stop rankings-prefetch-pg`). Synthetic community Users are confined to that local database.
