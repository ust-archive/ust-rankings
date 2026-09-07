# UST Rankings

[UST Rankings](https://ust-rankings.com/) provides Course and Instructor
rankings, teaching Details, and authenticated community contributions for HKUST
students.

Public Catalog, Ranking, Instructor identity, and Schedule queries run in one
DuckDB-Wasm Web Worker per browser tab against an immutable Delivery Dataset.
The application service keeps a paired Server Index in memory for static
Instructor identity and authoritative contribution validation; it does not
query public Parquet. See [`docs/data-pipeline.md`](docs/data-pipeline.md),
[`data/rankings.md`](data/rankings.md), [`data/schedule.md`](data/schedule.md),
and [`contributions/README.md`](contributions/README.md).

## Development

The repository uses Node 26.7 and npm 12. Install npm 12 with
`npm install --global npm@12.0.2`, then run the complete local gate:

```sh
npm ci
npm run check
npm run test:browser
npm run build
```

Use `npm run dev` for local development. Biome is the formatter, linter, and
import organizer (`npm run check:write`); TypeScript remains a separate check
(`npm run type-check`). Backend tests are grouped by public seam in
[`test/README.md`](test/README.md). Chromium browser behavior is covered with
Playwright; visual and accessibility verification uses `agent-browser` as
required by [`AGENTS.md`](AGENTS.md).

## Production

Production is a 512 MiB DigitalOcean App Platform service in Singapore running
a Node 26 Docker image. The service owns accounts, Reviews, Signals,
moderation, attachments, and the verified Server Index. Browser data is served
from immutable DigitalOcean Spaces CDN generations; canonical archives remain
on Hugging Face.

Contributions use `CONTRIBUTIONS_POSTGRES_URL`. Attachments use a private SGP1
Space. The production scheduler only calls Attachment cleanup; data publication
and paired rollback run through `.github/workflows/update-data.yml`.

Required configuration is listed in `.env.example`. The Auth callback is
`/api/auth/callback/microsoft-entra-id`. Privacy Contact is
`PRIVACY_CONTACT_EMAIL` (default `ust-rankings@flandia.dev`).

## Connect

Should you have any suggestions, feel free to open an issue or email me.
