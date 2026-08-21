import {
  type CourseRankings,
  getRankings,
  InvalidRankingsQueryError,
  type RankingsOptions,
  RankingsUnavailableError,
  UnknownRankingsEntityError,
} from "@/lib/rankings/server";

type ReadCourseRankings = (
  entity: {
    type: "course";
    coursePrefix: string;
    courseNumber: string;
  },
  options?: RankingsOptions,
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
  configuration: Pick<RankingsOptions, "preset" | "weights"> = {},
  readRankings: ReadCourseRankings = readCourseRankings,
): Promise<CourseRankings | undefined> {
  const entity = { type: "course" as const, coursePrefix, courseNumber };
  try {
    return await readRankings(entity, { ...configuration, termCode });
  } catch (error) {
    if (error instanceof InvalidRankingsQueryError && termCode) {
      try {
        return await readRankings(entity, configuration);
      } catch (fallbackError) {
        if (isUnavailableCourse(fallbackError)) return undefined;
        throw fallbackError;
      }
    }
    if (isUnavailableCourse(error)) return undefined;
    throw error;
  }
}
