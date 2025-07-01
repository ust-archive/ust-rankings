import cqTermsObj from "../data-cq-terms.json";
import cqObj from "../data-cq.json";
import Fuse from "fuse.js";

export type Term = {
  term: string;
  termName: string;
};

export type CQ = {
  term: string;
  termName: string;
  cq: Course[];
};

export interface Course {
  career: string;
  subject: string;
  number: string;
  code: string;
  name: string;
  description: string;
  previousCodes: string;
  prerequisites: string;
  corequisites: string;
  exclusions: string;
  credits: number;
  attributes: CourseAttribute[];
  classes: CourseClass[];
}

export interface CourseAttribute {
  attribute: string;
  value: string;
  attributeDescription: string;
  valueDescription: string;
}

export interface CourseClass {
  section: string;
  number: string;
  remarks: string;
  quota: number;
  enroll: number;
  waitlist: number;
  consent: boolean;
  reservedQuota: CourseClassReservedQuota[];
  schedule: CourseClassSchedule[];
}

export interface CourseClassReservedQuota {
  name: string;
  quota: number;
  enroll: number;
}

export interface CourseClassSchedule {
  instructors: string[];
  venue: string;
  fromDate: string;
  toDate: string;
  weekdays: number[];
  fromTime: string | null;
  toTime: string | null;
}

// @ts-ignore the json is large so typescript cannot infer the type
export const cq: CQ[] = cqObj;
export const cqTerms: Term[] = cqTermsObj.sort((a, b) =>
  a.term.localeCompare(b.term),
);

export const currentTerm = cqTerms[cqTerms.length - 1];

const cqMap = Object.fromEntries(
  cq.map((it) => {
    return [it.term, it.cq];
  }),
);

const fuseMap = Object.fromEntries(
  cq.map((it) => {
    return [
      it.term,
      new Fuse(it.cq, {
        keys: ["subject", "samples", "code", "classes.number"],
        shouldSort: false,
        useExtendedSearch: true,
        threshold: 0.2,
      }),
    ];
  }),
);

export function searchCourses(term: string, query: string): Course[] {
  if (query.length === 0) {
    return cqMap[term];
  }
  return fuseMap[term].search(query).map((it) => it.item);
}

export function findClass(
  term: string,
  number: string,
): [Course, CourseClass] | undefined {
  for (const course of cqMap[term]) {
    for (const class_ of course.classes) {
      if (class_.number === number) {
        return [course, class_];
      }
    }
  }
}
