import { createEvents, type EventAttributes } from "ics";
import { DateTime } from "luxon";
import calendars from "@/lib/schedule/holidays.json";
import { PathAdvisor } from "@/lib/schedule/path-advisor";
import type { CalendarClass, ScheduleMeeting } from "@/lib/schedule/server";

const weekdays: ScheduleMeeting["weekday"][] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

function utcParts(value: DateTime): [number, number, number, number, number] {
  const utc = value.toUTC();
  return [utc.year, utc.month, utc.day, utc.hour, utc.minute];
}

/** Export already-resolved meetings; no Schedule query is performed here. */
export async function createScheduleCalendar(
  classes: readonly CalendarClass[],
) {
  const events: EventAttributes[] = [];
  let omitted = 0;
  for (const item of classes) {
    for (const meeting of item.meetings) {
      if (
        !meeting.dateFrom ||
        !meeting.dateTo ||
        !meeting.timeFrom ||
        !meeting.timeTo
      ) {
        omitted++;
        continue;
      }
      const first = DateTime.fromISO(meeting.dateFrom, {
        zone: "Asia/Hong_Kong",
      });
      const weekday = weekdays.indexOf(meeting.weekday) + 1;
      const date = first
        .plus({ days: (weekday - first.weekday + 7) % 7 })
        .toISODate();
      const start = DateTime.fromISO(`${date}T${meeting.timeFrom}`, {
        zone: "Asia/Hong_Kong",
      });
      let end = DateTime.fromISO(`${date}T${meeting.timeTo}`, {
        zone: "Asia/Hong_Kong",
      });
      let until = DateTime.fromISO(`${meeting.dateTo}T${meeting.timeTo}`, {
        zone: "Asia/Hong_Kong",
      });
      if (
        !weekday ||
        !start.isValid ||
        !end.isValid ||
        !until.isValid ||
        !date ||
        date > meeting.dateTo
      ) {
        omitted++;
        continue;
      }
      if (end <= start) {
        end = end.plus({ days: 1 });
        until = until.plus({ days: 1 });
      }
      // The source has no meeting ID. Keep the former calendar's recurrence-slot UID
      // so reordering or updating rooms/Instructors does not duplicate imported events.
      const slot = [
        meeting.weekday,
        meeting.dateFrom,
        meeting.dateTo,
        meeting.timeFrom,
        meeting.timeTo,
      ].join("\0");
      const identity = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(slot)),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 24);
      const path = meeting.room
        ? PathAdvisor.findPathTo(meeting.room)
        : undefined;
      const exclusionDates: number[] = [];
      // Explicit single-date meetings may be special or makeup sessions: preserve
      // the supplied occurrence. Only expand/correct recurring source ranges.
      if (meeting.dateFrom !== meeting.dateTo) {
        for (
          let occurrence = start;
          occurrence.toFormat("yyyy-MM-dd") <= meeting.dateTo;
          occurrence = occurrence.plus({ weeks: 1 })
        ) {
          const academicYear =
            occurrence.month >= 9 ? occurrence.year : occurrence.year - 1;
          const calendar = calendars.find(
            (calendar) => calendar.academicYear === academicYear,
          );
          if (!calendar)
            throw new Error(
              `HKUST holiday dates for ${academicYear}–${academicYear + 1} are unavailable. The calendar could not be exported safely.`,
            );
          const localDate = occurrence.toFormat("yyyy-MM-dd");
          if (
            calendar.closures.some(
              (closure) =>
                closure.from <= localDate && localDate < closure.until,
            )
          )
            exclusionDates.push(occurrence.toMillis());
        }
      }
      events.push({
        uid: `${item.termCode}-${item.classNumber}-${identity}@ust-rankings`,
        start: utcParts(start),
        startInputType: "utc",
        end: utcParts(end),
        endInputType: "utc",
        title: `${item.courseCode} ${item.section} - ${item.courseTitle}`,
        location: meeting.room,
        description: [
          `Instructor: ${meeting.instructors.map((instructor) => instructor.sourceName).join(", ") || "TBA"}`,
          path ? `Path Advisor: ${path}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        exclusionDates: exclusionDates.length ? exclusionDates : undefined,
        recurrenceRule: `FREQ=WEEKLY;UNTIL=${until.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
      });
    }
    if (!item.meetings.length) omitted++;
  }
  if (!events.length)
    throw new Error("Selected Classes have no dated meetings to export.");
  const calendar = createEvents(
    [...new Map(events.map((event) => [event.uid, event])).values()],
    {
      productId: "-//UST Rankings//Schedule//EN",
      calName: "UST Schedule",
    },
  );
  if (calendar.error || !calendar.value)
    throw new Error(
      "Calendar could not be generated. Try downloading it again.",
    );
  return { body: calendar.value, omitted };
}
