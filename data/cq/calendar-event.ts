import { Course, CourseClass } from "@/data/cq/index";
import { PathAdvisor } from "@/data/cq/path-advisor";
import {
  convert,
  DayOfWeek,
  LocalDate,
  LocalTime,
  ZoneId,
  ZoneOffset,
} from "@js-joda/core";
import type * as ics from "ics";
import { RRule } from "rrule";

require("@js-joda/timezone");

const HongKongTZ = ZoneId.of("Asia/Hong_Kong");

function findDayOfWeekAfter(after: LocalDate, dayOfWeek: DayOfWeek): LocalDate {
  while (after.dayOfWeek() !== dayOfWeek) {
    after = after.plusDays(1);
  }
  return after;
}

export function generateEventAttributes(
  course: Course,
  courseClass: CourseClass,
): ics.EventAttributes[] {
  return courseClass.schedule
    .filter((schedule) => schedule.fromTime && schedule.toTime)
    .flatMap((schedule) =>
      schedule.weekdays.flatMap((weekday) => {
        const fromDate =
          weekday === 0
            ? findDayOfWeekAfter(
                LocalDate.parse(schedule.fromDate),
                DayOfWeek.of(7),
              )
            : findDayOfWeekAfter(
                LocalDate.parse(schedule.fromDate),
                DayOfWeek.of(weekday),
              );
        const toDate = LocalDate.parse(schedule.toDate);
        const fromTime = LocalTime.parse(schedule.fromTime!)
          .atDate(fromDate)
          .atZone(HongKongTZ)
          .withZoneSameInstant(ZoneOffset.UTC);
        const toTime = LocalTime.parse(schedule.toTime!)
          .atDate(fromDate)
          .atZone(HongKongTZ)
          .withZoneSameInstant(ZoneOffset.UTC);
        const untilTime = LocalTime.parse(schedule.toTime!)
          .atDate(toDate)
          .atZone(HongKongTZ)
          .withZoneSameInstant(ZoneOffset.UTC);
        const rrule = new RRule({
          freq: RRule.WEEKLY,
          until: convert(untilTime).toDate(),
        });
        return {
          start: [
            fromTime.year(),
            fromTime.monthValue(),
            fromTime.dayOfMonth(),
            fromTime.hour(),
            fromTime.minute(),
          ],
          startInputType: "utc",
          end: [
            toTime.year(),
            toTime.monthValue(),
            toTime.dayOfMonth(),
            toTime.hour(),
            toTime.minute(),
          ],
          endInputType: "utc",
          title: `${course.subject} ${course.number} ${courseClass.section} - ${course.name}`,
          location: schedule.venue,
          description: `Instructor: ${schedule.instructors.join(", ")}\nPath Advisor: ${PathAdvisor.findPathTo(schedule.venue)}`,
          recurrenceRule: rrule.toString().replace(/^RRULE:/, ""),
        } satisfies ics.EventAttributes;
      }),
    );
}
