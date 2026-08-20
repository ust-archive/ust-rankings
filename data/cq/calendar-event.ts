import type * as ics from "ics";
import { DateTime } from "luxon";
import { RRule } from "rrule";
import type { Course, CourseClass } from "./index";
import { PathAdvisor } from "./path-advisor";

const HONG_KONG_ZONE = "Asia/Hong_Kong";

function scheduleDateTime(date: string, time: string): DateTime {
  const value = DateTime.fromISO(`${date}T${time}`, { zone: HONG_KONG_ZONE });
  if (!value.isValid) {
    throw new Error(`Invalid Schedule date/time: ${date} ${time}`);
  }
  return value;
}

function firstWeekdayOnOrAfter(date: string, weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error(`Invalid Schedule weekday: ${weekday}`);
  }

  const start = scheduleDateTime(date, "00:00:00");
  const luxonWeekday = weekday === 0 ? 7 : weekday;
  const result = start
    .plus({ days: (luxonWeekday - start.weekday + 7) % 7 })
    .toISODate();
  if (result === null) {
    throw new Error(`Invalid Schedule date: ${date}`);
  }
  return result;
}

function utcParts(value: DateTime): [number, number, number, number, number] {
  const utc = value.toUTC();
  return [utc.year, utc.month, utc.day, utc.hour, utc.minute];
}

export function generateEventAttributes(
  course: Course,
  courseClass: CourseClass,
): ics.EventAttributes[] {
  return courseClass.schedule.flatMap((schedule) => {
    const { fromTime, toTime } = schedule;
    if (!fromTime || !toTime) {
      return [];
    }

    return schedule.weekdays.map((weekday) => {
      const fromDate = firstWeekdayOnOrAfter(schedule.fromDate, weekday);
      const start = scheduleDateTime(fromDate, fromTime);
      const end = scheduleDateTime(fromDate, toTime);
      const recurrenceEnd = scheduleDateTime(schedule.toDate, toTime);
      const rrule = new RRule({
        freq: RRule.WEEKLY,
        until: recurrenceEnd.toUTC().toJSDate(),
      });
      return {
        start: utcParts(start),
        startInputType: "utc",
        end: utcParts(end),
        endInputType: "utc",
        title: `${course.subject} ${course.number} ${courseClass.section} - ${course.name}`,
        location: schedule.venue,
        description: `Instructor: ${schedule.instructors.join(", ")}\nPath Advisor: ${PathAdvisor.findPathTo(schedule.venue)}`,
        recurrenceRule: rrule.toString().replace(/^RRULE:/, ""),
      } satisfies ics.EventAttributes;
    });
  });
}
