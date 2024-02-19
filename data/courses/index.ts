import {RRule} from 'rrule';
import type * as ics from 'ics';

import currentTerm from './term.json';
import {convert, DayOfWeek, type LocalDate, LocalTime, nativeJs} from '@js-joda/core';
import Fuse from 'fuse.js';

import calendarObj from './calendar.json';
import scheduleObj from './schedule.json';

export type Schedule = Record<string, Course[]>;
export type Course = {
  program: string;
  code: string;
  name: string;
  units: number;
  description: string;
  sections: Section[];
};
export type Section = {
  section: string;
  number: number;
  schedule: SectionSchedule;
  instructors: string[];
  room: string;
  quota: number[];
};
export type SectionSchedule = {
  day: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
  start: string;
  end: string;
};

const SCHEDULE = scheduleObj as Schedule;
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

export function eventAttrFrom(course: Course, section: Section): ics.EventAttributes {
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

export const courses = Object.values(SCHEDULE).flat();

const courseForSearch = courses.map(course => ({
  ...course,
  key: `${course.program} ${course.code}`,
}));

const fuse = new Fuse(courseForSearch, {
  keys: ['name', 'key', 'sections.number', 'sections.room', 'sections.instructors'],
  shouldSort: false,
  useExtendedSearch: true,
  threshold: 0.2,
});

export function search(query: string): Course[] {
  return fuse.search(query).map(it => it.item);
}

export function toPathAdvisorName(name: string): string | undefined {
  // The rules of Path Advisor are as follows:
  // if the name is like "Rm 1409, Lift 25-26 (60)", then it should be "ROOM 1409";
  // if the name is like "Lecture Theater A", then it should be "LTA";
  // if the name is like "G001, CYT Bldg", then it should be "CYTG001";
  // if the name is like "G001, LSK Bldg (70)", then it should be "LSKG001";
  // if the name is like "Rm 103, Shaw Auditorium", then it should be "SA103";
  // if the name is still like "Rm 1104, xxx", then it should be "ROOM 1104";
  // otherwise, return null.

  const reMainBuilding1 = /Rm (\w+), Lift (.*)/g;
  const reLT = /Lecture Theater (\w+)/g;
  const reCYT = /(\w+), CYT Bldg/g;
  const reLSK = /(\w+), LSK Bldg/g;
  const reSA = /Rm (\w+), Shaw Auditorium/g;
  const reMainBuilding2 = /Rm (\w+)/g;

  const reMainBuildingResult1 = reMainBuilding1.exec(name);
  if (reMainBuildingResult1) {
    return `${reMainBuildingResult1[1]}`;
  }

  const reLTResult = reLT.exec(name);
  if (reLTResult) {
    return `LT${reLTResult[1]}`;
  }

  const reCYTResult = reCYT.exec(name);
  if (reCYTResult) {
    return `CYT${reCYTResult[1]}`;
  }

  const reLSKResult = reLSK.exec(name);
  if (reLSKResult) {
    return `LSK${reLSKResult[1]}`;
  }

  const reSAResult = reSA.exec(name);
  if (reSAResult) {
    return `SA${reSAResult[1]}`;
  }

  const reMainBuilding2Result = reMainBuilding2.exec(name);
  if (reMainBuilding2Result) {
    return `${reMainBuilding2Result[1]}`;
  }

  return undefined;
}
