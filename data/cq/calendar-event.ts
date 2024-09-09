import { Course, CourseClass } from "@/data/cq/index";
import { PathAdvisor } from "@/data/cq/path-advisor";
import { convert, DayOfWeek, LocalDate, LocalTime } from "@js-joda/core";
import type * as ics from "ics";
import { RRule } from "rrule";

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
        const fromTime = LocalTime.parse(schedule.fromTime!);
        const toTime = LocalTime.parse(schedule.toTime!);
        const rrule = new RRule({
          freq: RRule.WEEKLY,
          until: convert(toDate).toDate(),
        });
        return {
          start: [
            fromDate.year(),
            fromDate.monthValue(),
            fromDate.dayOfMonth(),
            fromTime.hour(),
            fromTime.minute(),
          ],
          end: [
            fromDate.year(),
            fromDate.monthValue(),
            fromDate.dayOfMonth(),
            toTime.hour(),
            toTime.minute(),
          ],
          title: `${course.subject} ${course.number} ${courseClass.section} (${courseClass.number}) - ${course.name}`,
          location: schedule.venue,
          description: `Instructor: ${schedule.instructors.join(", ")}\nPath Advisor: ${PathAdvisor.findPathTo(schedule.venue)}`,
          recurrenceRule: rrule.toString().replace(/^RRULE:/, ""),
        } satisfies ics.EventAttributes;
      }),
    );
}
