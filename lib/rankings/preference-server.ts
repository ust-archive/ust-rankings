import { cookies } from "next/headers";
import {
  DEFAULT_RANKING_PREFERENCE,
  parseRankingPreference,
  RANKING_PREFERENCE_COOKIE,
  rankingPreferenceQuery,
} from "@/lib/rankings/preference";

export async function readRankingPreference() {
  try {
    return parseRankingPreference(
      (await cookies()).get(RANKING_PREFERENCE_COOKIE)?.value,
    );
  } catch {
    return DEFAULT_RANKING_PREFERENCE;
  }
}

export async function readRankingPreferenceQuery() {
  return rankingPreferenceQuery(await readRankingPreference());
}
