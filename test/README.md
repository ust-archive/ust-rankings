# Test seams

The default suite verifies behavior through the public interfaces that callers
use. Run it with `npm test`, or focus one file while working, for example:
`npm test -- test/review-service.test.ts`.

`npm run test:browser` exercises rendered behavior in Chromium. The separate
`test:contracts` suite exercises the Postgres adapters and needs
`TEST_CONTRIBUTIONS_POSTGRES_URL`. CI supplies a disposable Postgres instance.
The Spaces adapter test injects deterministic SDK client and signing mocks.
It checks object keys, request fields, and signing options without remote
transfers. There is no remote Spaces contract test or environment-variable
opt-in for one; uploads, downloads, provider permissions, and CORS are not
verified against a real Space by this suite.

Deployment workflow tests execute the workflow's Bash script with a fake
`doctl`. They require Bash and `jq` on `PATH`; on Windows, use Git Bash.

Tests mock only external seams such as Auth, Postgres, Spaces, time, and remote
sources. They do not assert internal call order. Vitest isolates test files in
workers while keeping independent files parallel.

Critical navigation behavior is automated through the rendered browser
interface with Playwright. Browser tests use accessible roles, labels, URLs,
and browser-level controls rather than test-only markup or private framework
protocols. Chromium runs the full suite, including the Waitlist flows. Run them
with `npm run test:browser`.

Follow `AGENTS.md` for visual coverage that automation does not replace: run the
app, inspect desktop and 390px screenshots with `agent-browser`, exercise
keyboard interactions, and run its WCAG audit.
