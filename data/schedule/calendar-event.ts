import {convert, DayOfWeek, type LocalDate, LocalTime, nativeJs} from '@js-joda/core';
import type * as ics from 'ics';
import {RRule} from 'rrule';
import {type Section, sectionToCourse} from '@/data/schedule/index';
import currentTerm from '@/data/schedule/term.json';
import calendarObj from '@/data/schedule/calendar.json';

const [ACADEMIC_YEAR, TERM] = currentTerm.split(' ');
const SEMESTER_START = nativeJs(
  new Date(
    Object.values(calendarObj)
      .filter(event => event.type === 'VEVENT')
      .map(event => event as {summary: string; start: string})
      .find(event => `${TERM} Term commences` === event.summary)!
      .start,
  ),
).toLocalDate();
const SEMESTER_END = nativeJs(
  new Date(
    Object.values(calendarObj)
      .filter(event => event.type === 'VEVENT')
      .map(event => event as {summary: string; start: string})
      .find(event => `Last day of ${TERM} Term classes` === event.summary)!
      .start,
  ),
).toLocalDate();

function findDayOfWeekAfter(after: LocalDate, dayOfWeek: DayOfWeek): LocalDate {
  while (after.dayOfWeek() !== dayOfWeek) {
    after = after.plusDays(1);
  }

  return after;
}

export function generateEventAttributes(section: Section): ics.EventAttributes {
  const course = sectionToCourse.get(section.number)!;

  const start = findDayOfWeekAfter(SEMESTER_START, DayOfWeek[section.schedule.day])
    .atTime(LocalTime.parse(section.schedule.start));
  const end = findDayOfWeekAfter(SEMESTER_START, DayOfWeek[section.schedule.day])
    .atTime(LocalTime.parse(section.schedule.end));

  const rrule = new RRule({
    freq: RRule.WEEKLY,
    until: convert(SEMESTER_END).toDate(),
  });

  return {
    start: [start.year(), start.monthValue(), start.dayOfMonth(), start.hour(), start.minute()],
    end: [end.year(), end.monthValue(), end.dayOfMonth(), end.hour(), end.minute()],
    title: `${course.program} ${course.code} ${section.section} (${section.number}) - ${course.name}`,
    location: section.room,
    recurrenceRule: rrule.toString().replace(/^RRULE:/, ''),
  };
}
