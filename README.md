# UST Rankings

[UST Rankings](https://ust-rankings.com/) provides Course and Instructor
rankings, teaching Details, calendar subscriptions, and authenticated community
contributions for HKUST students.

Ranking evidence is published as immutable Hugging Face generations. Schedule
data resolves Course Offerings, Classes, and Instructor identities for Details
and calendar subscriptions. See [`rankings/README.md`](rankings/README.md),
[`schedule/README.md`](schedule/README.md), and
[`contributions/README.md`](contributions/README.md) for each module's runtime
contract.

## Development

The repository uses Node 24.19 and npm 12 for dependency installation,
scripts, tests, and the data workspace. Install npm 12 with
`npm install --global npm@12.0.2`, then run the complete local gate from the
repository root:

```sh
npm ci
npm run check
npm run build
```

Use `npm run dev` for local development; it refreshes the generated Course
Catalog before starting Next.js. For fixture data, copy `.env.example` to
`.env.local`, set `AUTH_SECRET`, and uncomment `RANKINGS_SEED_DIR` and
`SCHEDULE_SEED_DIR`. Biome is the formatter, linter, and import organizer
(`npm run check:write`), while TypeScript remains a separate check
(`npm run type-check`).

Backend tests are grouped by public seam so one module can be checked quickly;
see [`test/README.md`](test/README.md). Frontend verification is visual with
`agent-browser`, as required by [`AGENTS.md`](AGENTS.md).

## Production

Production is DigitalOcean App Platform in Singapore with a Node 24 Docker
image. Rankings and Schedule download from
Hugging Face into `/tmp` at runtime; do not bake seed data into the image.
Neon `POSTGRES_URL` is the advisory lock database. Contributions use
`CONTRIBUTIONS_POSTGRES_URL`. Attachments use a private SGP1 Space.

Required configuration is listed in `.env.example`. Health:

- `GET /api/health/rankings`
- `GET /api/health/schedule`

Auth callback:

- `/api/auth/callback/microsoft-entra-id`

Privacy Contact is `PRIVACY_CONTACT_EMAIL` (default `ust-rankings@flandia.dev`).
Rotate Entra and Space credentials after first production use if they were
shared in a working session.

## Connect

Should you have any suggestions, feel free to open an issue or email me.
