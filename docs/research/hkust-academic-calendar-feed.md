# Research: Dynamic HKUST academic-calendar dates

## Summary

HKUST exposes two useful live sources on its official University Event Calendar. The page-linked iCalendar feed is the best source for current/future dates: `https://calendar.hkust.edu.hk/events/ics?ics_mode=academic_calendar`. The same page reveals a JSON calendar endpoint, `/api/calendar-dates`, which accepts FullCalendar-style `start`/`end` date parameters and can return historical records, but it is an undocumented Drupal implementation endpoint and has an observed multi-day expansion anomaly.

For `ust-rankings`, use the ICS feed first for the current/future academic calendar, use the JSON endpoint only for bounded historical/backfill queries, and keep a small last-known-good/static fallback sourced from the Academic Registry's year-specific PDF links. Do not infer dates from term start dates or hard-code a perpetual date table.

## Findings

### 1. The event calendar explicitly links the academic-calendar ICS feed

The official category page is:

- [`calendar.hkust.edu.hk/?category=1155`](https://calendar.hkust.edu.hk/?category=1155)

The page's raw HTML identifies category `1155` as **Academic Calendar**, exposes an RSS link, and exposes this calendar subscription link:

> `<a href="https://calendar.hkust.edu.hk/events/ics?ics_mode=academic_calendar" class="btn-add-to-calendar"> Add <span class="category">Academic Calendar 2026-27</span> to my calendar </a>`

The page also exposes the calendar's browser data source in its Drupal settings:

> `"hkustEvents":{"calendarAPIUrl":"\/api\/calendar-dates?category%5B0%5D=1155\u0026date\u0026organizer\u0026tag\u0026audiences\u0026ics_mode\u0026exclude_other_units"}`

This is strong evidence that the ICS URL is an intended public subscription URL. The JSON URL is exposed for the page's FullCalendar widget, but is not documented as a public API. [Academic Calendar category page](https://calendar.hkust.edu.hk/?category=1155)

### 2. ICS response format, dates, timezone, and recurrence behavior

A direct GET of [`/events/ics?ics_mode=academic_calendar`](https://calendar.hkust.edu.hk/events/ics?ics_mode=academic_calendar) returns an iCalendar body beginning:

```ical
BEGIN:VCALENDAR
PRODID:-//HKUST Drupal Platform//EN
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Asia/Hong_Kong
BEGIN:STANDARD
DTSTART:20071104T020000
TZOFFSETFROM:+0700
TZOFFSETTO:+0800
TZNAME:HKT
END:STANDARD
END:VTIMEZONE
```

The current response contains the expected registration events. For example:

```ical
BEGIN:VEVENT
DTSTAMP;TZID=Asia/Hong_Kong:20260826T122340
DTSTART;TZID=Asia/Hong_Kong:20260825T000000
DTEND;TZID=Asia/Hong_Kong:20260826T235900
SUMMARY:Class Enrollment starts – All UG students *  [* A validation period for class enrollment will be arranged prior to these dates]
UID:47777
END:VEVENT
...
BEGIN:VEVENT
DTSTART;TZID=Asia/Hong_Kong:20260901T000000
DTEND;TZID=Asia/Hong_Kong:20260914T235900
SUMMARY:Add/Drop Period
UID:47775
END:VEVENT
```

Implementation implications:

- Interpret the `DTSTART`/`DTEND` values as **Asia/Hong_Kong local calendar dates**. The feed uses local midnight through `23:59` for all-day events; do not convert midnight to UTC and accidentally shift the date.
- The academic calendar feed has no `RRULE` or `RDATE` in the verified response. Multi-day periods are represented as one `VEVENT` with a start and end, not as recurrence rules.
- `DTSTAMP` is retrieval/publication metadata, not the event date.
- Use the first local date for “enrollment starts” and the final local date for the ordinary `Add/Drop Period` deadline. Preserve the feed's end date instead of applying a generic exclusive-end adjustment: HKUST's event page independently describes the same interval as September 1–14. [ICS feed](https://calendar.hkust.edu.hk/events/ics?ics_mode=academic_calendar) · [Add/Drop event](https://calendar.hkust.edu.hk/events/adddrop-period-18)

The event's HTML also has Schema.org date-only fields. The Add/Drop page returns:

> `"startDate": "2026-09-01",`
> `"endDate": "2026-09-14",`

The UG enrollment event returns:

> `"startDate": "2026-08-25",`
> `"endDate": "2026-08-26",`

[Add/Drop event page](https://calendar.hkust.edu.hk/events/adddrop-period-18) · [UG enrollment event page](https://calendar.hkust.edu.hk/events/class-enrollment-starts-all-ug-students-validation-period-class-enrollment-will-be-13)

### 3. The JSON endpoint and its parameters

The page's exposed endpoint is:

```text
https://calendar.hkust.edu.hk/api/calendar-dates?category%5B0%5D=1155&start=YYYY-MM-DD&end=YYYY-MM-DD
```

Directly verified behavior:

- `category%5B0%5D=1155` selects the Academic Calendar category.
- `start` and `end` are accepted as date-only strings. A one-day request such as `start=2026-09-01&end=2026-09-02` returns JSON records for that day.
- The raw body is a JSON array of objects with this shape:

  ```json
  {"id":"47775","title":"Add/Drop Period","start":"2026-09-01","end":"2026-09-01"}
  ```

- Multi-day events are expanded into repeated daily records with the same `id` and `title`, rather than returned as one interval. A bounded query around 2026 Fall returns daily `Add/Drop Period` records through September 14.
- The page also exposes empty filter slots named `date`, `organizer`, `tag`, `audiences`, `ics_mode`, and `exclude_other_units`. Their presence is evidence of the page's filter contract, not proof that every combination is stable; only `category[0]`, `start`, and `end` were relied on here.
- The endpoint without a usable `start`/`end` range returned `[]` in direct tests. A lone `date=2026-09-01` also returned `[]`; use `start`/`end`, not `date`, for programmatic range queries.

Representative direct responses:

- [`start=2026-09-01&end=2026-09-02`](https://calendar.hkust.edu.hk/api/calendar-dates?category%5B0%5D=1155&start=2026-09-01&end=2026-09-02) returned the September 1 `Add/Drop Period` record.
- [`start=2026-08-20&end=2026-09-16`](https://calendar.hkust.edu.hk/api/calendar-dates?category%5B0%5D=1155&start=2026-08-20&end=2026-09-16) returned the surrounding enrollment and add/drop records.
- [`start=2025-08-20&end=2025-09-16`](https://calendar.hkust.edu.hk/api/calendar-dates?category%5B0%5D=1155&start=2025-08-20&end=2025-09-16) returned 2025 Fall enrollment and add/drop records.

#### API anomaly (medium severity)

The endpoint is not a clean interval API. In repeated direct tests, a broad range containing the 2026 multi-day Add/Drop event returned daily rows from September 2 through September 14, while the one-day request beginning September 1 returned the September 1 row. The event page and ICS feed both say the interval starts September 1. This may be a range-boundary/expansion quirk in the Drupal endpoint.

Therefore, do not reconstruct an authoritative interval solely from the first/last JSON daily row. Prefer the ICS `VEVENT` or the event detail page for current dates. If the JSON endpoint is used for historical backfill, query a one-day margin on both sides, group by `(id, title)`, and cross-check the result against the Registry PDF or event page where possible.

### 4. RSS exists but is not the primary implementation source

The category page links:

- [`/events/rss?ics_mode=academic_calendar`](https://calendar.hkust.edu.hk/events/rss?ics_mode=academic_calendar)

A category-filtered direct request, [`/events/rss?category%5B0%5D=1155`](https://calendar.hkust.edu.hk/events/rss?category%5B0%5D=1155), returns RSS/XML with normal `<item>` elements. Example:

```xml
<item>
  <title><![CDATA[Add/Drop Period]]></title>
  <link><![CDATA[https://calendar.hkust.edu.hk/events/adddrop-period-18]]></link>
  <guid><![CDATA[https://calendar.hkust.edu.hk/events/adddrop-period-18]]></guid>
  <description><![CDATA[When: 1  September  2026 - 14  September  2026]]></description>
</item>
```

It is useful as a human-readable fallback, but the direct response contains only a small recent set of items (five category items in the verified response), and no documented pagination or historical-range parameter was found. Also, `ics_mode=academic_calendar` without the category parameter did not reliably act like a category filter for RSS: a direct request returned general recent events. Use ICS/JSON instead. [RSS endpoint](https://calendar.hkust.edu.hk/events/rss?category%5B0%5D=1155)

### 5. Current, past, and future coverage

The feeds have different coverage windows.

| Source/query | Directly observed coverage | Consequence |
| --- | --- | --- |
| ICS, no range | 2026-08-08 through 2027-07-01 in the verified response | Good for the current 2026-27 calendar, but not a historical archive. |
| ICS with `start`/`end` for 2025, 2024, or 2023 | Returned the same current/future 2026-27 body in direct tests | The ICS endpoint did not honor those extra range parameters in testing. Do not use it for history. |
| JSON API, 2025 range | Returned 2025 Fall dates and January 2025 enrollment dates | Some past event data is available. Spring 2025 Add/Drop was not present in the verified event response. |
| JSON API, 2026 range | Returned 2026 dates, including Fall enrollment and Add/Drop | Suitable for current-year querying, subject to the anomaly above. |
| JSON API, 2027 range | Returned 2027 dates, including Spring/Fall and Summer events | Future coverage exists while HKUST has published it. |
| JSON API, 2024 and 2028 ranges | Returned `[]` | Empty does not mean “no academic dates”; it can mean the event database has no records for that year. |
| Registry Academic Calendar guide | Links 2021-22, 2022-23, 2023-24, 2024-25, 2025-26, and 2026-27 | Official PDF fallback covers more past years than the event API. |

The direct Registry index contains these year links:

> `Calendar Dates 2026-27`
> `Calendar Dates 2025-26`
> `Calendar Dates 2024-25`
> `Calendar Dates 2023-24`
> `Calendar Dates 2022-23`
> `Calendar Dates 2021-22`

[Academic Calendar guide](https://registry.hkust.edu.hk/resource-library/academic-calendar)

### 6. Registry PDFs are official, stable historical fallbacks

The Academic Registry's year pages resolve the actual PDF URL rather than requiring an invented filename. For example:

- [`Calendar Dates 2025-26` page](https://registry.hkust.edu.hk/resource-library/calendar-dates-2025-26) links to [`dates25-26confirmed.pdf`](https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf).
- [`Calendar Dates 2026-27` page](https://registry.hkust.edu.hk/resource-library/calendar-dates-2026-27) links to [`dates26-27confirmed.pdf`](https://registry.hkust.edu.hk/calendar_dates/dates26-27confirmed.pdf).
- [`Calendar Dates 2024-25` page](https://registry.hkust.edu.hk/resource-library/calendar-dates-2024-25-0) links to [`dates24-25confirmed.pdf`](https://registry.hkust.edu.hk/calendar_dates/dates24-25confirmed.pdf).

The confirmed PDFs contain the exact registration dates needed by the model:

**2025-26 confirmed PDF** ([source](https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf)):

> `26-27 Class Enrollment starts – All UG students`
> `26 Class Enrollment starts – All PG students`
> `1-13 Add/Drop Period`
> `27-28 Class Enrollment starts – All UG students` (January 2026)
> `27 Class Enrollment starts – All PG students`
> `2-14 Add/Drop Period` (February 2026)

**2026-27 confirmed PDF** ([source](https://registry.hkust.edu.hk/calendar_dates/dates26-27confirmed.pdf)):

> `25-26 Class Enrollment starts – All UG students`
> `25 Class Enrollment starts – All PG students`
> `1-14 Add/Drop Period`
> `26-27 Class Enrollment starts – All UG students` (January 2027)
> `26 Class Enrollment starts – All PG students`
> `1-17 Add/Drop Period` (February 2027)

The PDF's visual calendar gives the academic-year context, so these are not merely inferred from term dates. [Academic Calendar guide](https://registry.hkust.edu.hk/resource-library/academic-calendar)

### 7. Recommended minimal integration for `ust-rankings`

#### Primary path: ICS for current/future

1. Fetch `https://calendar.hkust.edu.hk/events/ics?ics_mode=academic_calendar` with a bounded timeout.
2. Parse `VEVENT` records and match exact/normalized summaries:
   - `Class Enrollment starts – All UG students ...`
   - `Class Enrollment starts – All PG students ...`
   - `Add/Drop Period`
   - `Extended Drop Period – for PG courses only`
3. Convert all event times using `Asia/Hong_Kong`; store local `start_date`, `end_date`, `summary`, `uid`, `source_url`, and retrieval time.
4. Associate events to the term using the nearby `Fall Term commences`, `Spring Term commences`, `Winter Term commences`, or the academic-year text in the summary. Do not associate by calendar year alone.
5. For the ordinary waitlist outcome, use the ordinary `Add/Drop Period` end date. Keep PG extended drop as a separate optional deadline; it must not silently replace the regular deadline for UG or a UG course taken by a PG student.

The ICS feed is the most defensible current source because HKUST itself links it as “Add ... Academic Calendar ... to my calendar” and it retains the interval in one event.

#### Historical/backfill path: JSON API, then Registry PDF

For a target year absent from the ICS response:

1. Query a narrow date range with `category[0]=1155`, `start`, and `end`.
2. Add a one-day margin around the expected term window.
3. Group daily rows by `id` and `title`, and take the observed min/max dates.
4. Cross-check the ordinary Add/Drop dates against the year-specific Registry PDF. Treat an API `[]` as “not found,” not as evidence that no dates exist.

#### Minimal fallback when live feeds fail

Use the Registry Academic Calendar index as the resolver:

1. Fetch [`/resource-library/academic-calendar`](https://registry.hkust.edu.hk/resource-library/academic-calendar).
2. Find the target `Calendar Dates YYYY-YY` guide link in the HTML.
3. Follow that guide's embedded PDF link.
4. Parse or manually-reviewed-extract the small set of registration rows into a checked table.
5. Cache the last successful source URL, retrieval time, and parsed values. If serving cached values after a fetch failure, label them stale; never silently present stale official dates as live.

A small checked table generated from the official PDFs is preferable to adding a PDF parser to the runtime. Refresh it when the official guide changes or at the start of each academic-year planning cycle. Constructing `datesYY-YYconfirmed.pdf` by string convention alone is not robust: resolve the link from the Registry page first, because provisional/confirmed naming and publication timing can change.

### 8. Implications for waitlist prediction

- The official calendar supplies **normal enrollment start windows**, not a course's pre-enrollment date. No pre-enrollment event was present in the verified Academic Calendar ICS response. Keep the previously agreed `Queue Activation` (first observed positive wait) as a data-derived clock, and retain official normal-enrollment start as a separate feature.
- Use at least two clocks in the estimator: `days_since_normal_enrollment_start` and `days_since_queue_activation`, plus `days_until_regular_add_drop_end`.
- Keep the official ordinary Add/Drop end date separate from PG extended drop. The user's population/course career determines which outcome deadline applies.
- A calendar fetch cannot solve waitlist identity, reserved-quota eligibility, or individual promotion observability. It only fixes the temporal alignment and prevents comparing one year's pre-enrollment snapshot with another year's post-enrollment snapshot.

## Sources

### Kept

- [HKUST University Event Calendar — Academic Calendar category](https://calendar.hkust.edu.hk/?category=1155) — primary page that exposes the ICS link, RSS link, category ID, and JSON calendar URL.
- [HKUST Academic Calendar ICS feed](https://calendar.hkust.edu.hk/events/ics?ics_mode=academic_calendar) — directly verified iCalendar response, timezone, event summaries, UIDs, and date intervals.
- [HKUST Calendar JSON endpoint](https://calendar.hkust.edu.hk/api/calendar-dates?category%5B0%5D=1155&start=2026-09-01&end=2026-09-02) — directly verified JSON response shape and range behavior.
- [HKUST Add/Drop event](https://calendar.hkust.edu.hk/events/adddrop-period-18) — primary event detail and Schema.org date fields.
- [HKUST UG enrollment event](https://calendar.hkust.edu.hk/events/class-enrollment-starts-all-ug-students-validation-period-class-enrollment-will-be-13) — primary event detail and enrollment date fields.
- [HKUST Academic Registry Academic Calendar guide](https://registry.hkust.edu.hk/resource-library/academic-calendar) — official list of year-specific calendar pages (2021-22 through 2026-27).
- [HKUST 2025-26 confirmed calendar PDF](https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf) — exact confirmed enrollment and Add/Drop dates for 2025-26.
- [HKUST 2026-27 confirmed calendar PDF](https://registry.hkust.edu.hk/calendar_dates/dates26-27confirmed.pdf) — exact confirmed enrollment and Add/Drop dates for 2026-27.
- [HKUST RSS category feed](https://calendar.hkust.edu.hk/events/rss?category%5B0%5D=1155) — verified XML fallback with event links and human-readable date ranges, but limited coverage.

### Dropped

- None of the sources used above were dropped for trust reasons. General web-search results and non-HKUST pages were excluded to honor the primary-source-only requirement.

## Gaps and residual risks

1. **Undocumented JSON API:** the route is exposed by the official page but has no public API contract or version guarantee. Keep ICS and Registry fallback paths.
2. **JSON interval expansion anomaly:** broad ranges can omit the first daily row of a multi-day event; cross-check against ICS/event pages/PDFs.
3. **ICS retention window:** direct range parameters did not expand the feed into history. Historical backfill must use Registry PDFs or the JSON endpoint where records exist.
4. **Course-specific exceptions:** the academic calendar includes general periods; Class Notes/SIS may contain irregular course-specific deadlines. The calendar feed cannot replace those class-level dates.
5. **Career semantics:** the feed has separate UG and PG enrollment events and a PG-only extended drop period. The service must not apply one date blindly to every student/course.
6. **Pre-enrollment:** no official pre-enrollment event was found in the verified category feed. It remains a distinct, data-derived phase.

## Acceptance report

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "This report documents directly verified HKUST ICS, JSON, RSS, event-page, and Registry-PDF findings, with concrete endpoint URLs, exact response excerpts, coverage limits, severity-tagged risks, and a minimal fallback design."
    }
  ],
  "changedFiles": [
    "C:\\Users\\Flandia\\.pi\\agent\\sessions\\--D--Projects-@ust-archive-ust-rankings--\\subagent-artifacts\\outputs\\4e5b2048-0869-4557-a7a0-06d0e84262a2\\research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search: four primary-source HKUST calendar/API queries",
      "result": "passed",
      "summary": "Located the Academic Calendar category, ICS link, JSON calendar endpoint, RSS link, and Registry guide/PDF sources."
    },
    {
      "command": "fetch_content: HKUST ICS endpoint and date-range variants",
      "result": "passed",
      "summary": "Verified VCALENDAR body, Asia/Hong_Kong timezone, event summaries, UIDs, intervals, and lack of historical range behavior."
    },
    {
      "command": "fetch_content: HKUST JSON calendar endpoint with 2024-2028 ranges",
      "result": "passed",
      "summary": "Verified JSON shape, start/end filtering, 2025-2027 availability, empty 2024/2028 results, and the multi-day boundary anomaly."
    },
    {
      "command": "fetch_content: HKUST Registry guide, year pages, and confirmed PDFs",
      "result": "passed",
      "summary": "Verified year-link coverage and exact 2025-26, 2026-27 enrollment/Add-Drop rows."
    }
  ],
  "validationOutput": [
    "Direct bodies parsed/inspected: ICS VCALENDAR, JSON arrays, RSS XML, HTML/Schema.org, and PDF text extraction.",
    "No repository files outside the authoritative runtime artifact were edited."
  ],
  "residualRisks": [
    "The JSON endpoint is undocumented and may change.",
    "The JSON multi-day expansion has an observed boundary anomaly.",
    "ICS does not provide verified historical coverage; Registry PDFs remain necessary for backfill.",
    "General calendar dates may not cover Class-specific SIS deadlines."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added one cited Markdown research artifact; no production code or other files changed.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Use the ICS feed as the live primary source, JSON only as bounded backfill, and resolve Registry PDF links through the Academic Calendar index rather than guessing filenames."
}
```
