import {
  type CourseRankings,
  getRankings,
  InvalidRankingsQueryError,
  RankingsUnavailableError,
} from "@/lib/rankings/server";

export async function loadCourseRankings(
  coursePrefix: string,
  courseNumber: string,
): Promise<CourseRankings | undefined> {
  try {
    return await getRankings({ type: "course", coursePrefix, courseNumber });
  } catch (error) {
    if (
      error instanceof RankingsUnavailableError ||
      error instanceof InvalidRankingsQueryError ||
      error instanceof TypeError
    )
      return undefined;
    throw error;
  }
}
