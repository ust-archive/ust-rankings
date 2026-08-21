import {
  RANKING_CRITERIA,
  type RankingCriterion,
} from "@/lib/rankings/configuration";
import type { RankingPreset, RankingWeights } from "@/lib/rankings/server";

export const RANKING_PREFERENCE_COOKIE = "ranking-preference";

export type RankingPreference = {
  preset: RankingPreset | "custom";
  weights: RankingWeights;
};

export const DEFAULT_RANKING_PREFERENCE: RankingPreference = {
  preset: "learning",
  weights: {},
};

export function parseRankingPreference(value?: string): RankingPreference {
  if (!value) return DEFAULT_RANKING_PREFERENCE;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as {
      preset?: unknown;
      weights?: unknown;
    };
    if (
      parsed.preset !== "learning" &&
      parsed.preset !== "grade" &&
      parsed.preset !== "custom"
    )
      return DEFAULT_RANKING_PREFERENCE;
    const entries = Object.entries(parsed.weights ?? {}).flatMap(
      ([criterion, weight]) =>
        RANKING_CRITERIA.includes(criterion as RankingCriterion) &&
        typeof weight === "number" &&
        Number.isFinite(weight) &&
        weight >= 0
          ? [[criterion, weight] as const]
          : [],
    );
    const weights = Object.fromEntries(entries);
    if (
      parsed.preset === "custom" &&
      !Object.values(weights).some((weight) => weight > 0)
    )
      return DEFAULT_RANKING_PREFERENCE;
    return { preset: parsed.preset, weights };
  } catch {
    return DEFAULT_RANKING_PREFERENCE;
  }
}

export function rankingPreferenceQuery(preference: RankingPreference) {
  return preference.preset === "custom"
    ? { weights: preference.weights }
    : { preset: preference.preset };
}

export function serializeRankingPreference(preference: RankingPreference) {
  return encodeURIComponent(JSON.stringify(preference));
}
