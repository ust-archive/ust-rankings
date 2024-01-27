import dataObj from './data.json';

export type RatingObject = {
  time: number;
  rating: number;
};

export type CourseObject = {
  program: string;
  code: string;
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
