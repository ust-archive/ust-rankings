import dataInstructorJSON from "./data-instructor.json";
import Fuse from "fuse.js";
import _ from "lodash";

export type InstructorScoreObject = {
  instructor: string;
  term: number;

  ratingContent: number;
  ratingTeaching: number;
  ratingGrading: number;
  ratingWorkload: number;
  ratingInstructor: number;
  score: number;
  samples: number;

  individualRatingContent: number;
  individualRatingTeaching: number;
  individualRatingGrading: number;
  individualRatingWorkload: number;
  individualRatingInstructor: number;
  individualSamples: number;

  bayesianRatingContent: number;
  bayesianRatingTeaching: number;
  bayesianRatingGrading: number;
  bayesianRatingWorkload: number;
  bayesianRatingInstructor: number;
  bayesianScore: number;

  confidence: number;
};

export type InstructorExtraObject = {
  historicalCourses: InstructorCourseObject[];
  courses: InstructorCourseObject[];
};

export type InstructorCourseObject = {
  subject: string;
  number: string;
};

export type InstructorObject = {
  instructor: string;
  scores: InstructorScoreObject[];
  rank: number;
  percentile: number;
  historicalCourses: Array<{ subject: string; number: string }>;
  courses: Array<{ subject: string; number: string }>;
} & InstructorExtraObject;

// @ts-expect-error the JSON is huge, so the type is not correctly inferred
export const dataInstructorObjects: Record<string, InstructorObject> =
  dataInstructorJSON;
export const dataInstructorKeys = Object.keys(dataInstructorObjects);

export type SortBy =
  | "bayesianScore"
  | "bayesianRatingContent"
  | "bayesianRatingTeaching"
  | "bayesianRatingGrading"
  | "bayesianRatingWorkload"
  | "bayesianRatingInstructor"
  | "score"
  | "ratingContent"
  | "ratingTeaching"
  | "ratingGrading"
  | "ratingWorkload"
  | "ratingInstructor";

export type RatingType =
  | "ratingContent"
  | "ratingTeaching"
  | "ratingGrading"
  | "ratingWorkload"
  | "ratingInstructor";

export type ScoreWeights = Record<RatingType, number>;

export function search(
  query: string,
  sortBy: SortBy,
  scoreWeights: ScoreWeights,
): InstructorObject[] {
  const sortedInstructorObjects = _.chain(dataInstructorObjects)
    .values()
    .map((instructorObj) => ({
      ...instructorObj,
      scores: instructorObj.scores.map((score) => ({
        ...score,
        score:
          scoreWeights.ratingContent * score.ratingContent +
          scoreWeights.ratingTeaching * score.ratingTeaching +
          scoreWeights.ratingGrading * score.ratingGrading +
          scoreWeights.ratingWorkload * score.ratingWorkload +
          scoreWeights.ratingInstructor * score.ratingInstructor,
        bayesianScore:
          scoreWeights.ratingContent * score.bayesianRatingContent +
          scoreWeights.ratingTeaching * score.bayesianRatingTeaching +
          scoreWeights.ratingGrading * score.bayesianRatingGrading +
          scoreWeights.ratingWorkload * score.bayesianRatingWorkload +
          scoreWeights.ratingInstructor * score.bayesianRatingInstructor,
      })),
    }))
    .sortBy((instructor) => -instructor.scores[0][sortBy])
    .map((instructorObj, i) => ({
      ...instructorObj,
      rank: i + 1,
      percentile: 1 - i / dataInstructorKeys.length,
    }))
    .map((instructorObj) => ({
      name: instructorObj.instructor,
      courses: [
        ...instructorObj.historicalCourses.map(
          (course) => `${course.subject} ${course.number}`,
        ),
        ...instructorObj.historicalCourses.map(
          (course) => `${course.subject}${course.number}`,
        ),
        ...instructorObj.courses.map(
          (course) => `${course.subject} ${course.number} (A)`,
        ),
        ...instructorObj.courses.map(
          (course) => `${course.subject}${course.number} (A)`,
        ),
      ],
      obj: instructorObj,
    }))
    .value();

  if (query) {
    const fuse = new Fuse(sortedInstructorObjects, {
      keys: ["name", "courses"],
      shouldSort: false,
      useExtendedSearch: true,
      threshold: 0.1,
    });

    return fuse.search(query).map((it) => it.item.obj);
  }

  return sortedInstructorObjects.map((it) => it.obj);
}
