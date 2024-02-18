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

export const data: Instructor[] = dataObj;
data.sort((a, b) => a.ranking - b.ranking);

const dataForSearch = data.map(instructor => ({
  ...instructor,
  courses: instructor.courses.map(course => ({
    ...course,
    str: `${course.program} ${course.code}`,
  })),
}));

const fuse = new Fuse(dataForSearch, {
  keys: ['name', 'courses.str', 'grade'],
  shouldSort: false,
  useExtendedSearch: true,
  threshold: 0.2,
});

export function search(query: string): Instructor[] {
  return fuse.search(query).map(it => it.item);
}
