# Test seams

The default suite verifies behavior through the public interfaces that callers
use. Run all backend seams with `npm test`, or one focused seam while
working:

| Script | Public seam |
| --- | --- |
| `test:accounts` | User establishment, policy, and authenticated session |
| `test:attachments` | Attachment service and HTTP route handlers |
| `test:moderation` | Moderation service and server actions |
| `test:rankings` | Ranking query, Details lookup, refresh, and health |
| `test:reviews` | Review service, associations, reads, and server actions |
| `test:schedule` | Schedule query, Details lookup, calendar, and refresh |
| `test:signals` | Thumbs Vote and Emoji Reaction service and server actions |

The separate `test:contracts` suite exercises the Postgres adapters and needs
`TEST_CONTRIBUTIONS_POSTGRES_URL`. CI supplies a disposable Postgres instance.
The Spaces test uses a deterministic local adapter by default and enables its
remote contract only when `TEST_ATTACHMENTS_SPACE_BUCKET` is configured.

Tests mock only external seams such as Auth, Postgres, Spaces, time, and remote
sources. They do not assert internal call order. Vitest isolates test files in
workers while keeping independent files parallel.

Frontend behavior is not automated in this repository. Follow `AGENTS.md`: run
the app, inspect desktop and 390px screenshots with `agent-browser`, exercise
keyboard interactions, and run its WCAG audit. This keeps visual checks tied to
the rendered interface instead of implementation markup.
