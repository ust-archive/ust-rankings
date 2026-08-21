"use server";

import { queryRankings, type RankingsQuery } from "@/lib/rankings/server";

export async function loadMoreRankings(query: RankingsQuery) {
  return queryRankings({ ...query, limit: 100 });
}
