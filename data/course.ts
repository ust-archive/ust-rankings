import dataCourseJSON from "./data-course.json";
import Fuse from "fuse.js";
import _ from "lodash";

export type CourseScoreObject = {
  subject: string;
  number: string;
  term: number;

  ratingContent: number;
  ratingTeaching: number;
  ratingGrading: number;
  ratingWorkload: number;
  samples: number;
  confidence: number;

  individualRatingContent: number;
  individualRatingTeaching: number;
  individualRatingGrading: number;
  individualRatingWorkload: number;
  individualSamples: number;
  individualConfidence: number;

  bayesianRatingContent: number;
  bayesianRatingTeaching: number;
  bayesianRatingGrading: number;
  bayesianRatingWorkload: number;

  score: number;
  bayesianScore: number;
};

export type CourseExtraObject = {
  subject: string;
  number: string;
  terms: number[];
  instructors: string[];
  historicalInstructors: string[];
};

export type CourseObject = {
  rank: number;
  percentile: number;
  scores: CourseScoreObject[];
} & CourseExtraObject;

// @ts-expect-error the JSON is huge, so the type is not correctly inferred
export const dataCourseObjects: Record<string, CourseObject> = dataCourseJSON;
export const dataCourseKeys = Object.keys(dataCourseObjects);

export type CourseSortBy = keyof Pick<
  CourseScoreObject,
  | "bayesianRatingContent"
  | "bayesianRatingTeaching"
  | "bayesianRatingGrading"
  | "bayesianRatingWorkload"
  | "ratingContent"
  | "ratingTeaching"
  | "ratingGrading"
  | "ratingWorkload"
  | "score"
  | "bayesianScore"
>;

export type CourseRatings = keyof Pick<
  CourseScoreObject,
  "ratingContent" | "ratingTeaching" | "ratingGrading" | "ratingWorkload"
>;

export type CourseRatingWeights = Record<CourseRatings, number>;

export function searchCourses(
  query: string,
  sortBy: CourseSortBy,
  weights: CourseRatingWeights,
): CourseObject[] {
  const sortedInstructorObjects = _.chain(dataCourseObjects)
    .values()
    // Calculate the score by the given formula
    .map((courseObj) => ({
      ...courseObj,
      scores: courseObj.scores.map((score) => ({
        ...score,
        score:
          weights.ratingContent * score.ratingContent +
          weights.ratingTeaching * score.ratingTeaching +
          weights.ratingGrading * score.ratingGrading +
          weights.ratingWorkload * score.ratingWorkload,
        bayesianScore:
          weights.ratingContent * score.bayesianRatingContent +
          weights.ratingTeaching * score.bayesianRatingTeaching +
          weights.ratingGrading * score.bayesianRatingGrading +
          weights.ratingWorkload * score.bayesianRatingWorkload,
      })),
    }))
    // Sort the courses by the given criterion
    .sortBy((instructor) => -instructor.scores[0][sortBy])
    // Assign the rank and percentile to each course
    .map((instructorObj, i) => ({
      ...instructorObj,
      rank: i + 1,
      percentile: 1 - i / dataCourseKeys.length,
    }))
    // Create searching indices
    .map((courseObj) => ({
      subject: courseObj.subject,
      number: courseObj.number,
      course: `${courseObj.subject} ${courseObj.number}`,
      instructors: [
        ...courseObj.instructors.map((instructor) => `${instructor} (A)`),
        ...courseObj.historicalInstructors.map((instructor) => `${instructor}`),
        ...courseObj.instructors.flatMap((instructor) =>
          instructor.split(", "),
        ),
        ...courseObj.historicalInstructors.flatMap((instructor) =>
          instructor.split(", "),
        ),
      ],
      obj: courseObj,
    }))
    .value();

  if (query) {
    const fuse = new Fuse(sortedInstructorObjects, {
      keys: ["subject", "number", "course", "instructors"],
      shouldSort: false,
      useExtendedSearch: true,
      threshold: 0.1,
    });

    return fuse.search(query).map((it) => it.item.obj);
  }

  return sortedInstructorObjects.map((it) => it.obj);
}
