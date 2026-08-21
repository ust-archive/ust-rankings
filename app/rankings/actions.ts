"use server";

import { queryRankings, type RankingsQuery } from "@/lib/rankings/server";

export async function loadMoreRankings(query: RankingsQuery) {
  const page = await queryRankings({ ...query, limit: 100 });
  return {
    nextCursor: page.nextCursor,
    results: page.results,
    termCode: page.population.termCode,
  };
}
