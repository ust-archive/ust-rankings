import "server-only";

import { createHash } from "node:crypto";
import * as ics from "ics";
import { DateTime } from "luxon";
import { RRule } from "rrule";
import { PathAdvisor } from "@/lib/schedule/path-advisor";
import {
  InvalidScheduleQueryError,
  resolveClassesWithGeneration,
  type ScheduleClass,
  type ScheduleMeeting,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

const HONG_KONG_ZONE = "Asia/Hong_Kong";
const weekdayNumbers: Record<ScheduleMeeting["weekday"], number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

type CalendarResult = {
  body: string;
  etag: string;
  normalizedPath: string;
};

type CalendarEvent = ics.EventAttributes & { timestamp: ics.DateTime };

function scheduleDateTime(date: string, time: string) {
  const value = DateTime.fromISO(`${date}T${time}`, { zone: HONG_KONG_ZONE });
  if (!value.isValid) throw new Error("Invalid Schedule meeting date/time");
  return value;
}

function firstMeetingDate(meeting: ScheduleMeeting) {
  if (!meeting.dateFrom) throw new Error("Meeting date is unavailable");
  const weekday = weekdayNumbers[meeting.weekday];
  if (!weekday) throw new Error("Invalid Schedule meeting weekday");
  const start = scheduleDateTime(meeting.dateFrom, "00:00");
  return start.plus({ days: (weekday - start.weekday + 7) % 7 });
}

/**
 * The source has no meeting ID. Its recurrence slot is the durable identity;
 * room and Instructor changes update that meeting instead of minting a UID.
 */
function meetingIdentity(meeting: ScheduleMeeting) {
  return createHash("sha256")
    .update(
      [
        meeting.weekday,
        meeting.dateFrom,
        meeting.dateTo,
        meeting.timeFrom,
        meeting.timeTo,
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 24);
}

function utcParts(value: DateTime): [number, number, number, number, number] {
  const utc = value.toUTC();
  return [utc.year, utc.month, utc.day, utc.hour, utc.minute];
}

function eventAttributes(
  scheduleClass: ScheduleClass,
  meeting: ScheduleMeeting,
): CalendarEvent | undefined {
  if (
    !meeting.dateFrom ||
    !meeting.dateTo ||
    !meeting.timeFrom ||
    !meeting.timeTo
  )
    return undefined;

  const firstDate = firstMeetingDate(meeting).toISODate();
  if (!firstDate) throw new Error("Invalid Schedule meeting date");
  const start = scheduleDateTime(firstDate, meeting.timeFrom);
  let end = scheduleDateTime(firstDate, meeting.timeTo);
  let recurrenceEnd = scheduleDateTime(meeting.dateTo, meeting.timeTo);
  if (end <= start) {
    end = end.plus({ days: 1 });
    recurrenceEnd = recurrenceEnd.plus({ days: 1 });
  }
  const recurrence = new RRule({
    freq: RRule.WEEKLY,
    until: recurrenceEnd.toUTC().toJSDate(),
  });
  const instructors = meeting.instructors
    .map((instructor) => instructor.sourceName)
    .join(", ");
  const path = meeting.room ? PathAdvisor.findPathTo(meeting.room) : undefined;

  return {
    uid: `${scheduleClass.termCode}-${scheduleClass.classNumber}-${meetingIdentity(meeting)}@ust-rankings`,
    timestamp: 0,
    start: utcParts(start),
    startInputType: "utc",
    end: utcParts(end),
    endInputType: "utc",
    title: `${scheduleClass.courseCode} ${scheduleClass.section} - ${scheduleClass.courseTitle}`,
    location: meeting.room,
    description: [
      `Instructor: ${instructors || "TBA"}`,
      path ? `Path Advisor: ${path}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    recurrenceRule: recurrence.toString().replace(/^RRULE:/, ""),
  };
}

function classEvents(scheduleClass: ScheduleClass) {
  const events = scheduleClass.meetings.flatMap((meeting) => {
    const event = eventAttributes(scheduleClass, meeting);
    return event ? [event] : [];
  });
  const uids = new Set(events.map((event) => event.uid));
  if (uids.size !== events.length)
    throw new Error("Duplicate Schedule meeting identity");
  return events;
}

export async function generateScheduleCalendar(
  termCode: string,
  classNumbers: ReadonlyArray<number>,
): Promise<CalendarResult> {
  const resolved = await resolveClassesWithGeneration(termCode, classNumbers);
  const normalizedNumbers = resolved.classes.map(
    (scheduleClass) => scheduleClass.classNumber,
  );
  const calendar = ics.createEvents(resolved.classes.flatMap(classEvents), {
    productId: "-//UST Rankings//Schedule//EN",
    calName: "UST Schedule",
  });
  if (calendar.error || calendar.value === null)
    throw new Error(calendar.error?.message ?? "Calendar generation failed");
  const identity = `${resolved.generation}\n${termCode}\n${normalizedNumbers.join(",")}\n${calendar.value}`;
  const parameters = new URLSearchParams({ term: termCode });
  for (const classNumber of normalizedNumbers)
    parameters.append("class", String(classNumber));
  return {
    body: calendar.value,
    etag: `"${createHash("sha256").update(identity).digest("hex")}"`,
    normalizedPath: `/schedule/calendar.ics?${parameters}`,
  };
}

function parseRequest(request: Request, classParameter: "class" | "number") {
  const url = new URL(request.url);
  const terms = url.searchParams.getAll("term");
  const values = url.searchParams.getAll(classParameter);
  if (terms.length !== 1 || values.length === 0)
    throw new InvalidScheduleQueryError(
      "Use exactly one Term Code and at least one Class Number.",
    );
  if (!/^[0-9]{4}$/.test(terms[0] ?? ""))
    throw new InvalidScheduleQueryError("Invalid Term Code.");
  if (
    values.length > 100 ||
    values.some((value) => !/^[1-9][0-9]{0,5}$/.test(value))
  )
    throw new InvalidScheduleQueryError("Invalid Class Numbers.");
  const downloads = url.searchParams.getAll("download");
  if (downloads.length > 1 || (downloads.length === 1 && downloads[0] !== "1"))
    throw new InvalidScheduleQueryError("Invalid download option.");
  return {
    termCode: terms[0] ?? "",
    classNumbers: values.map(Number),
    download: downloads.length === 1,
  };
}

export async function handleScheduleCalendar(
  request: Request,
  classParameter: "class" | "number",
) {
  try {
    const query = parseRequest(request, classParameter);
    const calendar = await generateScheduleCalendar(
      query.termCode,
      query.classNumbers,
    );
    const headers = new Headers({
      "Cache-Control": "public, max-age=300",
      "Content-Location": calendar.normalizedPath,
      "Content-Type": "text/calendar; charset=utf-8",
      ETag: calendar.etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (query.download)
      headers.set(
        "Content-Disposition",
        'attachment; filename="ust-schedule.ics"',
      );
    if (
      request.headers
        .get("if-none-match")
        ?.split(",")
        .map((value) => value.trim())
        .some(
          (value) =>
            value === "*" || value.replace(/^W\//, "") === calendar.etag,
        )
    )
      return new Response(null, { status: 304, headers });
    return new Response(calendar.body, { headers });
  } catch (error) {
    if (error instanceof InvalidScheduleQueryError)
      return new Response(error.message, {
        status: error.message.startsWith("Unknown Class Number") ? 404 : 400,
      });
    if (error instanceof ScheduleUnavailableError)
      return new Response("UST Schedule is unavailable.", { status: 503 });
    console.error(error);
    return new Response("Calendar generation failed.", { status: 500 });
  }
}
