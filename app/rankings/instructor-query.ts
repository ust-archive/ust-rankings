import { RANKING_CRITERIA } from "@/lib/rankings/configuration";
import type { RankingPreference } from "@/lib/rankings/preference";
import type { RankingsQuery } from "@/lib/rankings/server";

export type InstructorRankingSearchParams = Record<
  string,
  string | string[] | undefined
>;

export class InvalidInstructorRankingQueryError extends TypeError {}

function single(searchParams: InstructorRankingSearchParams, name: string) {
  const value = searchParams[name];
  if (Array.isArray(value))
    throw new InvalidInstructorRankingQueryError(`${name} must occur once.`);
  return value;
}

export function instructorRankingPages(
  searchParams: InstructorRankingSearchParams,
) {
  const value = single(searchParams, "pages");
  if (value === undefined)
    return single(searchParams, "cursor") === undefined ? 1 : 0;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new InvalidInstructorRankingQueryError(
      "pages must be a positive integer.",
    );
  if (value === "1" && single(searchParams, "cursor"))
    throw new InvalidInstructorRankingQueryError(
      "cursor requires pages greater than 1.",
    );
  return Number(value);
}

export function instructorRankingQuery(
  searchParams: InstructorRankingSearchParams,
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
  return {
    entity: "instructor",
    termCode: single(searchParams, "term"),
    preset: preset === "custom" ? undefined : preset,
    weights,
    activity: single(searchParams, "activity"),
    search: single(searchParams, "q"),
    coursePrefix: single(searchParams, "prefix"),
    course: single(searchParams, "course"),
    cursor: single(searchParams, "cursor"),
    limit: 100,
  } as RankingsQuery & { entity: "instructor" };
}
