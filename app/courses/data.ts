import {
  type CourseRankings,
  getRankings,
  InvalidRankingsQueryError,
  RankingsUnavailableError,
  UnknownRankingsEntityError,
} from "@/lib/rankings/server";

type ReadCourseRankings = (
  entity: {
    type: "course";
    coursePrefix: string;
    courseNumber: string;
  },
  options?: { termCode?: string },
) => Promise<CourseRankings>;

const readCourseRankings: ReadCourseRankings = (entity, options) =>
  getRankings(entity, options);

function isUnavailableCourse(error: unknown) {
  return (
    error instanceof RankingsUnavailableError ||
    error instanceof UnknownRankingsEntityError
  );
}

export async function loadCourseRankings(
  coursePrefix: string,
  courseNumber: string,
  termCode?: string,
  readRankings: ReadCourseRankings = readCourseRankings,
): Promise<CourseRankings | undefined> {
  const entity = { type: "course" as const, coursePrefix, courseNumber };
  try {
    return await readRankings(entity, { termCode });
  } catch (error) {
    if (error instanceof InvalidRankingsQueryError && termCode) {
      try {
        return await readRankings(entity);
      } catch (fallbackError) {
        if (isUnavailableCourse(fallbackError)) return undefined;
        throw fallbackError;
      }
    }
    if (isUnavailableCourse(error)) return undefined;
    throw error;
  }
}
