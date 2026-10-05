# Schedule calendar exports

Each source meeting keeps its own dates, time and venue. Rows show date ranges when a section has multiple periods, and show the date for a one-off meeting.

Recurring meetings exclude public holidays and the Spring mid-term break using HKUST Clear Water Bay's official calendar. An explicitly dated single-day session is preserved as a possible special or makeup session; this is a product precedence rule, not a claim of a blanket university exemption. No makeup dates are invented. Lecturer cancellations, weather suspensions and other ad hoc announcements require updates to the source meetings.

## Sources and updates

- Current calendar: https://caldates.ust.hk/cgi-bin/eng/ical.php, linked from https://caldates.ust.hk/cgi-bin/eng/index.php. Verified September 9, 2026: the feed exports 2026–27, includes holidays and Mid Term Break, and ignores the tested historical-year parameters. No public JSON endpoint was verified.
- Archived 2025–26 closures were transcribed from the confirmed Registry PDF: https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf. April 3–8, 2026 is the inclusive mid-term break.
- Current-year cross-check: https://registry.hkust.edu.hk/calendar_dates/dates26-27confirmed.pdf. March 25–30, 2027 is the inclusive mid-term break.

Run `node scripts/update-schedule-holidays.ts` to refresh the current official feed into `lib/schedule/holidays.json`, preserving captured historical years. Review the generated diff before publishing. The bundled snapshot avoids CORS and download-time network failures. Its source URL and retrieval date are recorded per academic year. A recurring meeting outside the captured academic years fails with an explicit error instead of silently exporting uncorrected dates.

The feed has no event categories. The parser selects holiday names and Mid Term Break, validates all-day date ranges, and handles exclusive ICS DTEND dates. It does not classify enrollment deadlines, study breaks, examinations or term boundaries as holiday closures. Source UIDs change across requests and DTSTAMP is stale; neither is used as a freshness signal or identity. Review the name matcher when HKUST changes feed wording.

The exporter emits EXDATE at the original meeting's Hong Kong local start instant, serialized in UTC. This preserves weekly recurrence and room/date-range segments. Download is a snapshot. Subscriptions use `/api/calendar?term=2610&class=2229` (the legacy `number` parameter is also accepted). The publisher includes dated meeting records in the Server Index. The endpoint exports selected Classes from the currently active generation using the same holiday rules; it never queries Parquet. Older indices without calendar records fail explicitly with 503. Publish a new Delivery generation when deploying this feature. Calendar apps determine their own refresh interval. A subscription retains its Class selection; changing the cart requires replacing the subscription URL. Localhost links cannot be fetched by cloud calendar providers.
