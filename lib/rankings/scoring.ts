import {
  RANKING_CRITERIA,
  type RankingCriterion,
} from "@/lib/rankings/configuration";

export type RankingPreset = "learning" | "grade";
export type RankingWeights = Partial<Record<RankingCriterion, number>>;

export const RANKING_PRESET_WEIGHTS: Record<
  "course" | "instructor",
  Record<RankingPreset, Record<RankingCriterion, number>>
> = {
  course: {
    learning: {
      content: 0.2667,
      teaching: 0.2667,
      grading: 0.1,
      workload: 0.0333,
      course: 0.25,
      instructor: 0.0833,
    },
    grade: {
      content: 0.0667,
      teaching: 0.0667,
      grading: 0.4,
      workload: 0.1333,
      course: 0.25,
      instructor: 0.0833,
    },
  },
  instructor: {
    learning: {
      content: 0.2667,
      teaching: 0.2667,
      grading: 0.1,
      workload: 0.0333,
      course: 0.0833,
      instructor: 0.25,
    },
    grade: {
      content: 0.0667,
      teaching: 0.0667,
      grading: 0.4,
      workload: 0.1333,
      course: 0.0833,
      instructor: 0.25,
    },
  },
};

export function normalizeRankingConfiguration(
  query: {
    entity: "course" | "instructor";
    preset?: RankingPreset;
    weights?: RankingWeights;
  },
  invalid: (message: string) => Error = (message) => new TypeError(message),
) {
  if (query.weights !== undefined) {
    const entries = Object.entries(query.weights);
    if (
      entries.some(
        ([criterion, value]) =>
          !RANKING_CRITERIA.includes(criterion as RankingCriterion) ||
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0,
      )
    )
      throw invalid("Custom ranking weights must be finite and non-negative.");
    const positive = entries
      .filter((entry) => entry[1] > 0)
      .sort(
        ([left], [right]) =>
          RANKING_CRITERIA.indexOf(left as RankingCriterion) -
          RANKING_CRITERIA.indexOf(right as RankingCriterion),
      ) as Array<[RankingCriterion, number]>;
    if (positive.length === 0)
      throw invalid(
        "Custom ranking weights need at least one non-zero criterion.",
      );
    const maximum = Math.max(...positive.map((entry) => entry[1]));
    const scaled = positive
      .map(([criterion, value]) => [criterion, value / maximum] as const)
      .filter((entry) => entry[1] > 0);
    const total = scaled.reduce((sum, entry) => sum + entry[1], 0);
    return {
      preset: "custom" as const,
      weights: Object.fromEntries(
        scaled.map(([criterion, value]) => [criterion, value / total]),
      ) as RankingWeights,
    };
  }
  const preset = query.preset ?? "learning";
  if (preset !== "learning" && preset !== "grade")
    throw invalid("Unknown Ranking Preset.");
  return { preset, weights: RANKING_PRESET_WEIGHTS[query.entity][preset] };
}

export function rankingScore(
  evidence: Partial<Record<RankingCriterion, { bayesian: number }>>,
  weights: RankingWeights,
) {
  const criteria = Object.keys(weights) as RankingCriterion[];
  if (criteria.some((criterion) => evidence[criterion] === undefined))
    return undefined;
  return criteria.reduce(
    (sum, criterion) =>
      sum +
      (evidence[criterion]?.bayesian as number) *
        (weights[criterion] as number),
    0,
  );
}

function percentile(rank: number, population: number) {
  return population === 1 ? 1 : (population - rank) / (population - 1);
}

export function rankingPositions<
  Candidate extends { key: string; score: number },
>(candidates: Candidate[]) {
  let rank = 0;
  let previousScore: number | undefined;
  return new Map(
    candidates.map((candidate, index) => {
      if (candidate.score !== previousScore) rank = index + 1;
      previousScore = candidate.score;
      return [
        candidate.key,
        {
          rank,
          population: candidates.length,
          percentile: percentile(rank, candidates.length),
        },
      ] as const;
    }),
  );
}
