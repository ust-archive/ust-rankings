# Search navigation readiness proposal

Draft for audit finding A23, discovered during the 2026-10-05 codebase audit's
follow-up browser verification on 2026-10-06. This changes the shared search
control used by Course rankings, Instructor rankings, Schedule, and WL.

## Observed failure

An immediate search can run after its React handler is attached but before
Next's AppRouter passive effect installs native history integration. Calling
`history.replaceState` in that interval changes the address bar without updating
`useSearchParams`. The search input and visible results can then disagree with
the URL indefinitely; no filtered Worker request is sent.

A read-only Chromium probe against real immutable Delivery generation
`ceb4b57f66314feeaf94f48a40467d01fd057cbfbbe3d818744d946e3b5fbda8`
on Next 16.3.8 reproduced this once in six fresh browser contexts. The first
route compilation was cold; the remaining five worked. Search replaced the URL
with `q=ACCT2010` at 9655.7 ms; Next installed its history integration at
9658.9 ms. Only the unfiltered WL Worker request was sent, and 24 Course
Offerings were still displayed after 30 seconds. The input reset to empty in
this reproduction. Six further CPU-throttled contexts worked. These are local
development observations, not production prevalence estimates.

## Proposed decision

Use the documented `useRouter().replace(url, { scroll: false })` API for each
search change. It updates the framework's navigation state directly rather
than depending on native history integration being installed. Keep local input
feedback, replace rather than append history entries, preserve other query
filters, and remove Ranking pagination through the existing helper. Preserve
the existing omission of a URL hash when building the search destination.
WL Plans remain local to their mounted page and must survive filtering away
and returning. Public analytical queries still execute in the browser Worker;
framework navigation is not a server analytical query fallback.

Unlike native history updates, this can request a new React Server Component
payload for each input change. The existing assertion that searching produces
no RSC navigation therefore changes in this draft. Before readiness, decide
whether that request cost is acceptable across all four search surfaces and
whether typing latency under a slow application connection is acceptable.
This patch adds no debouncing, new cache policy, or query runtime changes.

The alternative is to retain native history and gate or queue early input until
router integration is ready. That preserves the existing local navigation cost,
but requires a reliable readiness contract and a policy for replaying user input.
A child component's passive mount effect alone is not proof that the ancestor's
history integration has run. Waiting for the initial data cards in a test hides
the user-visible timing window.

The router API and scroll option are documented in the primary
[Next.js useRouter reference](https://nextjs.org/docs/app/api-reference/functions/use-router).

## Regression boundary

The rendered-browser regression deliberately delays the browser history
integration adapter while leaving framework history writes available. It types
before waiting for initial Course cards, observes the actual WL Worker input,
and requires filtered cards, input value, and URL to agree. The original search
implementation fails because no filtered request is sent. This is a controlled
adapter timing seam, not a fake query runtime or a mocked successful result.

Existing WL Plan retention, compact Course searches, Instructor searches, and
Course filter/pagination controls provide downstream coverage. Local real-data
before/after screenshots and Worker traces are review evidence; they do not
establish behavior under a production build or production network conditions.

## Coordination with pagination

The proposed router replacement is asynchronous. The pagination lifetime guard
in PR193 prevents an old page from writing after the destination URL commits,
but does not invalidate it when a search starts while that URL is still old.
A combined-source browser probe held the search RSC response, released a real
old Worker page, then released the search response. The old page wrote
`pages=2` and its cursor into the old URL and the requested search never
appeared. Waiting for new results before releasing the old page does not test
this interval.

The draft now adds one client-only search-intent revision shared by search and
pagination. Search increments it synchronously before router replacement. Each
pagination effect pins its revision and rejects requests, success, and error
completion after a newer intent, as well as checking its mounted lifetime and
the committed URL. No global event listener, Worker change, or persisted state is
added. The actual held-Worker/held-RSC regression is red without this revision
guard and green with it.

Final master `6600134bcc008b260803c4bbce93964b15351b5c` already contains PR193's lifecycle/URL guards, ordinary pending state and unchanged `test/browser/ranking-pagination.spec.ts`. This rebased draft adds only the search-intent coordination and router decision to that merged foundation.
Before readiness, decide recovery after a failed or canceled navigation that
never mounts a destination query. The invalidated old pagination is deliberately
not resumed; reloading re-establishes its lifetime. Returning to the same query
before an intermediate navigation commits also needs a recovery policy. A
URL-only guard is insufficient for the demonstrated pending-search interval.

## Navigation latency

The full combined browser run exposed another interaction: pagination awaited
the Worker inside `startTransition(async ...)`. With its response held, both a
search and a primary-navigation route failed to commit before the test released
the old page. React's documented current behavior
[batches concurrent transitions](https://react.dev/reference/react/useTransition).
The pagination Action could therefore hold framework navigation even though its
result was invalidated. Merely releasing the old page before waiting for navigation
would hide this latency coupling.

Merged PR193 now awaits pagination outside a React transition and tracks its request
spinner with ordinary local state. Search and route commits do not wait for an
unrelated pagination request; its eventual success/error must still pass the
intent, URL, and mounted-lifetime guards. The original PR193 tests retain their
ordering: commit the destination while the old page is held, then release that
page and require the destination to remain intact. The held-RSC regression also
retains its earlier-completion case. No Worker cancellation protocol or navigation
timeout policy is introduced.
