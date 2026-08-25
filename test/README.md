# Test seams

The default suite verifies behavior through the public interfaces that callers
use. Run all backend seams with `npm test`, or one focused seam while
working:

| Script | Public seam |
| --- | --- |
| `test:accounts` | User establishment, policy, and authenticated session |
| `test:attachments` | Attachment service and HTTP route handlers |
| `test:moderation` | Moderation service and server actions |
| `test:rankings` | Delivery manifest and Server Index activation/validation |
| `test:reviews` | Review service, associations, reads, and server actions |
| `test:schedule` | Schedule planner URL validation |
| `test:signals` | Thumbs Vote and Emoji Reaction service and server actions |
| `test:browser` | Rendered navigation, history, loading feedback, and progressive enhancement in Chromium |

The separate `test:contracts` suite exercises the Postgres adapters and needs
`TEST_CONTRIBUTIONS_POSTGRES_URL`. CI supplies a disposable Postgres instance.
The Spaces test uses a deterministic local adapter by default and enables its
remote contract only when `TEST_ATTACHMENTS_SPACE_BUCKET` is configured.

Tests mock only external seams such as Auth, Postgres, Spaces, time, and remote
sources. They do not assert internal call order. Vitest isolates test files in
workers while keeping independent files parallel.

Critical navigation behavior is automated through the rendered browser
interface with Playwright. Browser tests use accessible roles, labels, URLs,
and browser-level controls rather than test-only markup or private framework
protocols. Run them with `npm run test:browser`.

Follow `AGENTS.md` for visual coverage that automation does not replace: run the
app, inspect desktop and 390px screenshots with `agent-browser`, exercise
keyboard interactions, and run its WCAG audit.
