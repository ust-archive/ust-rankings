/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
import dataObj from './data.json';
import Fuse from 'fuse.js';

export type CourseObject = {
  program: string;
  code: string;
};

export type RatingObject = {
  rating: number;
  semester: number;
  course: CourseObject;
};

export type Instructor = {
  id: number;
  name: string;
  samples: number;
  thumbRatings: RatingObject[];
  teachRatings: RatingObject[];
  courses: CourseObject[];
  thumbRating: number;
  teachRating: number;
  overallRating: number;
  score: number;
  ranking: number;
  percentile: number;
  grade: string;
};

// @ts-ignore: the error is because the JSON file is too big.
export const data: Instructor[] = dataObj;
data.sort((a, b) => a.ranking - b.ranking);

const dataForSearch = data.map(instructor => ({
  ...instructor,
  allCourseStr: [
    ...new Set([
      ...instructor.courses.map(it => it.program + it.code),
      ...instructor.teachRatings.map(it => it.course.program + it.course.code),
      ...instructor.thumbRatings.map(it => it.course.program + it.course.code),
    ]),
  ],
}));

const fuse = new Fuse(dataForSearch, {
  keys: ['name', 'allCourseStr', 'grade'],
  shouldSort: false,
  useExtendedSearch: true,
  threshold: 0.10,
});

export function search(query: string): Instructor[] {
  return fuse.search(query).map(it => it.item);
}
