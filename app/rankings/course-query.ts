import { RANKING_CRITERIA } from "@/lib/rankings/configuration";
import type { RankingPreference } from "@/lib/rankings/preference";
import type {
  CommonCoreCategory,
  CommonCoreScheme,
  RankingsQuery,
} from "@/lib/rankings/server";

export type CourseRankingSearchParams = Record<
  string,
  string | string[] | undefined
>;

export class InvalidCourseRankingQueryError extends TypeError {}

function single(
  searchParams: CourseRankingSearchParams,
  name: string,
): string | undefined {
  const value = searchParams[name];
  if (Array.isArray(value))
    throw new InvalidCourseRankingQueryError(`${name} must occur once.`);
  return value;
}

export function courseRankingPages(searchParams: CourseRankingSearchParams) {
  const value = single(searchParams, "pages");
  if (value === undefined)
    return single(searchParams, "cursor") === undefined ? 1 : 0;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new InvalidCourseRankingQueryError(
      "pages must be a positive integer.",
    );
  if (value === "1" && single(searchParams, "cursor"))
    throw new InvalidCourseRankingQueryError(
      "cursor requires pages greater than 1.",
    );
  return Number(value);
}

export function courseRankingQuery(
  searchParams: CourseRankingSearchParams,
  preference: RankingPreference,
) {
  const queryPreset = single(searchParams, "preset");
  const preset = queryPreset ?? preference.preset;
  const weights =
    preset === "custom"
      ? Object.fromEntries(
          RANKING_CRITERIA.map((criterion) => [
            criterion,
            Number(
              single(searchParams, `weight_${criterion}`) ??
                (queryPreset ? 0 : preference.weights[criterion]) ??
                0,
            ),
          ]).filter(([, value]) => value !== 0),
        )
      : undefined;
  const categories = searchParams.commonCore;
  return {
    entity: "course",
    termCode: single(searchParams, "term"),
    preset: preset === "custom" ? undefined : preset,
    weights,
    activity: single(searchParams, "activity"),
    search: single(searchParams, "q"),
    commonCoreScheme: single(searchParams, "commonCoreScheme") as
      | CommonCoreScheme
      | undefined,
    commonCore: (Array.isArray(categories)
      ? categories
      : categories
        ? [categories]
        : []) as CommonCoreCategory[],
    cursor: single(searchParams, "cursor"),
    limit: 100,
  } as RankingsQuery & { entity: "course" };
}
