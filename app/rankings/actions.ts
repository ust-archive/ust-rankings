"use server";

import { queryRankings, type RankingsQuery } from "@/lib/rankings/server";

export async function loadMoreInstructorRankings(
  query: RankingsQuery & { entity: "instructor" },
) {
  if (query.entity !== "instructor")
    throw new TypeError("Only Instructor Rankings use the server action.");
  const page = await queryRankings({ ...query, limit: 100 });
  return {
    nextCursor: page.nextCursor,
    results: page.results,
    termCode: page.population.termCode,
  };
}
