import json from "../data-course-catalog.json";
import _ from "lodash";

export type Course = {
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  academicCareerType: string;
  academicCareer: string;
  schoolCode: string;
  departmentCode: string;
  courseName: string;
  minUnits: string;
  maxUnits: string;
  courseVector: string;
  courseVectorPrinted: string;
  courseDescription: string;
  previousCourseCodes: string[];
  alternativeCourseCodes: string[];
  coursePrerequisite: string;
  courseCorequisite: string;
  courseExclusion: string;
  courseBackground: string;
  courseColisted: string;
  courseCrossCampusEquivalence: string;
  courseReference: string;
  courseAttributes: {
    courseAttribute: string;
    courseAttributeValue: string;
    courseAttributeValueDescription: string;
  }[];
};

const catalog = _.keyBy(json, (c) => c.courseCode);

export function course(subject: string, code: string): Course | undefined;
export function course(courseCode: string): Course | undefined;

export function course(
  subjectOrCode: string,
  code?: string,
): Course | undefined {
  if (code) {
    return catalog[`${subjectOrCode}${code}`];
  } else {
    return catalog[subjectOrCode];
  }
}
