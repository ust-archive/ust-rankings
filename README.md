# UST Rankings

[UST Rankings](https://ust-rankings.com/) provides a basic rankings for instructors at HKUST, based on their teaching performance.

**Features**

- Data are updated time-by-time.
- Easily search for any instructor.
- Grade instructors by A+, A, etc. for intuitive understanding.
- Check trends on instructors' ratings.

![UST Rankings](https://github.com/Waver-Velvet/ust-rankings/assets/42676149/067b716a-7c74-4eb6-a232-cedf342d7dd0)
_The actual names are redacted because the rankings are changing time-by-time._

## UST Schedule

[UST Schedule](https://ust-rankings.vercel.app/schedule) is a sub-site of UST Rankings. It provides the functionality to inspect class schedules, marking them and importing them into user's calendar app.

**Features**

- Data are updated time-by-time.
- Both `webcal://` link and `.ics` file are available.
- Directly links the venue to Path Advisor.

![UST Schedule](https://github.com/Waver-Velvet/ust-rankings/assets/42676149/f553e971-bd62-4b0f-a487-8b77215e57ec)
_This is the dark theme, for demonstrational purpose._

## Development

The repository uses Bun 1.3.14 for dependency installation, scripts, tests, the
Next.js runtime, and the data workspace. Install from the repository root and
run the complete local gate with:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Use `bun run dev` for local development. Biome is the single formatter, linter,
and import organizer (`bun run check:write`), while TypeScript remains a
separate check (`bun run type-check`). Frontend Playwright tests are not run
(`AGENTS.md`).

## Production

Production is DigitalOcean App Platform in Singapore with a Node 22 Docker
image (Vercel Bun Functions hit SIGILL). Rankings and Schedule download from
Hugging Face into `/tmp` at runtime; do not bake seed data into the image.
Neon `POSTGRES_URL` is the advisory lock database. Contributions use
`CONTRIBUTIONS_POSTGRES_URL`. Attachments use a private SGP1 Space.

Required configuration is listed in `.env.example`. Health:

- `GET /api/health/rankings`
- `GET /api/health/schedule`

Auth callbacks:

- `/api/auth/callback/hkust-connect`
- `/api/auth/callback/hkust-staff`

Privacy Contact is `PRIVACY_CONTACT_EMAIL` (default `ust-rankings@flandia.dev`).
Rotate Entra and Space credentials after first production use if they were
shared in a working session.

## Connect

Should you have any suggestions, feel free to open an issue or email me.
