import scheduleObj from './schedule.json';
import Fuse from 'fuse.js';
import {groupBy} from '@/lib/utils';

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

export const schedule = scheduleObj as Schedule;
export const courses = Object.values(schedule).flat();
export const sections = courses.flatMap(course => course.sections);
export const sectionMap = groupBy(sections, section => section.number);

export const sectionToCourse = new Map(courses.flatMap(course => course.sections.map(section => [section.number, course])));

export function findClass(number: number): [Course, Section[]] {
  const sections = sectionMap[number];
  const course = sectionToCourse.get(number)!;
  return [course, sections];
}

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

export function searchCourses(query: string): Course[] {
  return fuse.search(query).map(it => it.item);
}

export function format(section: Section) {
  const course = sectionToCourse.get(section.number)!;
  return `${course.program} ${course.code} ${section.section} (${section.number})`;
}
