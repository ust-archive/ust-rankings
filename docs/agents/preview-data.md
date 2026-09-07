# Preview data

A preview is a review of the application against real data.

## Rule

Use a Delivery Generation built from immutable Hugging Face revisions for a
preview. Use the unified Schedule view at
`canonical/class_records.parquet`. Do not use browser fixtures for a preview.
Fixtures are valid for automated tests and ordinary development.

## Workflow

From the repository root, run the first command once:

```sh
npm run preview:data
```

Then use separate terminals:

```sh
node scripts/serve-browser-delivery.ts
NEXT_PUBLIC_DELIVERY_BASE_URL=http://127.0.0.1:17832 npm run dev -- --port 17831
```

In PowerShell, set the public URL before the Next.js command:

```powershell
$env:NEXT_PUBLIC_DELIVERY_BASE_URL = "http://127.0.0.1:17832"
npm run dev -- --port 17831
```

The first command downloads the current `ust-archive/ust-rankings` and
`ust-archive/schedule` revisions and uses DuckDB to build a local Delivery
Generation. It writes the pinned revisions and generation in its output. Keep
the Delivery server and Next.js server running while reviewing the preview at
`http://localhost:17831`.

A preview report must name the source revisions and must state if any real-data
source was unavailable. The waitlist report generator automatically uses the
pinned `.preview/schedule` files:

```sh
node data/prototypes/waitlist-clearance.ts
```

`scripts/generate-browser-fixture.ts` is for tests, not previews.
