import Link from "next/link";
import type { ReactNode } from "react";
import { coursePath } from "@/app/courses/routes";
import { instructorPath } from "@/app/instructors/routes";
import { NewReleaseBanner } from "@/components/component/new-release-banner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  COMMON_CORE_CATEGORIES,
  type CommonCoreCategory,
  type CourseRanking,
  type InstructorRanking,
  InvalidRankingsQueryError,
  queryRankings,
  type RankingsPage,
  type RankingsQuery,
  RankingsUnavailableError,
  StaleRankingsCursorError,
} from "@/lib/rankings/server";

type Entity = "course" | "instructor";
export type RankingSearchParams = Record<string, string | string[] | undefined>;
type Color = [number, number, number];

const criteria = [
  ["content", "Content"],
  ["teaching", "Teaching"],
  ["grading", "Grading"],
  ["workload", "Workload"],
  ["course", "Course SFQ"],
  ["instructor", "Instructor SFQ"],
] as const;
const scoreFormat = new Intl.NumberFormat("en", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const countFormat = new Intl.NumberFormat("en");

function rankingPath(entity: Entity) {
  return `/rankings/${entity === "course" ? "courses" : "instructors"}`;
}

function single(
  searchParams: RankingSearchParams,
  name: string,
): string | undefined {
  const value = searchParams[name];
  if (Array.isArray(value))
    throw new InvalidRankingsQueryError(`${name} must occur once.`);
  return value;
}

function first(
  searchParams: RankingSearchParams,
  name: string,
): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

function pageQuery(entity: Entity, searchParams: RankingSearchParams) {
  const preset = single(searchParams, "preset") ?? "learning";
  const weights =
    preset === "custom"
      ? Object.fromEntries(
          criteria
            .map(([criterion]) => [
              criterion,
              Number(single(searchParams, `weight_${criterion}`) ?? 0),
            ])
            .filter(([, value]) => value !== 0),
        )
      : undefined;
  const categories = searchParams.commonCore;
  return {
    entity,
    termCode: single(searchParams, "term"),
    preset: preset === "custom" ? undefined : preset,
    weights,
    activity: single(searchParams, "activity"),
    search: single(searchParams, "q"),
    coursePrefix: single(searchParams, "prefix"),
    commonCore:
      entity === "course"
        ? ((Array.isArray(categories)
            ? categories
            : categories
              ? [categories]
              : []) as CommonCoreCategory[])
        : undefined,
    course:
      entity === "instructor" ? single(searchParams, "course") : undefined,
    cursor: single(searchParams, "cursor"),
    limit: 100,
  } as RankingsQuery;
}

function nextPageHref(
  entity: Entity,
  searchParams: RankingSearchParams,
  cursor: string,
) {
  const next = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (name === "cursor" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      next.append(name, item);
  }
  next.set("cursor", cursor);
  return `${rankingPath(entity)}?${next}`;
}

function letterGrade(percentile: number) {
  for (const [threshold, grade] of [
    [0.9, "A+"],
    [0.8, "A"],
    [0.75, "A-"],
    [0.6, "B+"],
    [0.45, "B"],
    [0.35, "B-"],
    [0.3, "C+"],
    [0.25, "C"],
    [0.2, "C-"],
    [0.1, "D"],
    [0.0, "F"],
  ] as Array<[number, string]>) {
    if (percentile >= threshold) return grade;
  }
  return "F";
}

function gradeColor(ratio: number): Color {
  const stops = [
    { ratio: 0, color: [237, 27, 47] as Color },
    { ratio: 0.25, color: [250, 166, 26] as Color },
    { ratio: 0.75, color: [163, 207, 98] as Color },
    { ratio: 1, color: [0, 154, 97] as Color },
  ];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];
    if (ratio < current.ratio || ratio > next.ratio) continue;
    const progress = (ratio - current.ratio) / (next.ratio - current.ratio);
    return current.color.map((channel, channelIndex) =>
      Math.round(
        channel * (1 - progress) + next.color[channelIndex] * progress,
      ),
    ) as Color;
  }
  return [0, 0, 0];
}

function detailsHref(result: CourseRanking | InstructorRanking) {
  return result.entity === "course"
    ? coursePath(result.coursePrefix, result.courseNumber)
    : instructorPath(result);
}

function sampleCount(value: number, source: string) {
  return `${countFormat.format(value)} ${value === 1 ? "sample" : "samples"} from ${source}`;
}

function RankingResultCard({
  result,
}: {
  result: CourseRanking | InstructorRanking;
}) {
  const grade = letterGrade(result.globalPercentile);
  const score = scoreFormat.format(result.score * 100);
  const hasLocalContext =
    result.localRank !== result.globalRank ||
    result.localPopulation !== result.globalPopulation;
  return (
    <li
      style={{
        containIntrinsicSize: "auto 7rem",
        contentVisibility: "auto",
      }}
    >
      <Link
        className="group block touch-manipulation rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        href={detailsHref(result)}
        style={{ textDecoration: "none" }}
      >
        <Card className="bg-white transition-shadow hover:border-slate-300 hover:shadow-md group-focus-visible:border-slate-400">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 sm:gap-5 sm:p-6">
            <div className="w-20 shrink-0 text-slate-600 sm:w-32">
              <p className="text-xl font-semibold tabular-nums sm:text-2xl">
                #{result.localRank}{" "}
                <span className="hidden font-medium sm:inline">({score})</span>
              </p>
              <p className="text-xs tabular-nums sm:hidden">Score {score}</p>
            </div>
            <div className="min-w-0 text-left">
              <h2 className="wrap-break-word text-xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-2xl">
                {result.entity === "course"
                  ? result.courseCode
                  : result.canonicalName}
              </h2>
              {result.entity === "course" && result.title ? (
                <p className="text-sm font-semibold text-slate-600">
                  {result.title}
                </p>
              ) : null}
              <p className="text-xs leading-snug text-slate-600 sm:text-sm">
                {sampleCount(result.ustSpaceSamples, "ust.space")}.{" "}
                {sampleCount(result.sfqSamples, "SFQ")}.
              </p>
              <p className="text-xs leading-snug text-slate-500 tabular-nums">
                Global Rank {result.globalRank} of {result.globalPopulation}
                {hasLocalContext
                  ? ` · Local Rank ${result.localRank} of ${result.localPopulation}`
                  : ""}
              </p>
            </div>
            <div
              className="w-12 shrink-0 rounded-lg py-2 text-center text-xl font-semibold text-white shadow-sm sm:text-2xl"
              style={{
                backgroundColor: `rgb(${gradeColor(result.globalPercentile).join(", ")})`,
              }}
            >
              <span className="sr-only">Grade </span>
              {grade}
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}

function selectedPreset(
  rankings: RankingsPage | undefined,
  query: RankingsQuery | undefined,
  searchParams: RankingSearchParams,
) {
  if (rankings) return rankings.configuration.preset;
  if (query?.weights) return "custom";
  return query?.preset ?? first(searchParams, "preset") ?? "learning";
}

function fallbackTermName(termCode: string) {
  if (!/^[0-9]{4}$/.test(termCode)) return termCode;
  const year = 2000 + Number(termCode.slice(0, 2));
  const season = ["Fall", "Winter", "Spring", "Summer"][
    Number(termCode.slice(2, 3)) - 1
  ];
  return season ? `${year}-${String(year + 1).slice(-2)} ${season}` : termCode;
}

function ApplyButton({ children }: { children: ReactNode }) {
  return (
    <button
      className="min-h-11 rounded-md bg-[#003366] px-5 py-2.5 font-semibold text-white hover:bg-[#174f82] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
      type="submit"
    >
      {children}
    </button>
  );
}

function RankingForm({
  entity,
  searchParams,
  query,
  rankings,
}: {
  entity: Entity;
  searchParams: RankingSearchParams;
  query?: RankingsQuery;
  rankings?: RankingsPage;
}) {
  const label = entity === "course" ? "Course" : "Instructor";
  const preset = selectedPreset(rankings, query, searchParams);
  const selectedCategories = new Set(
    query?.commonCore ??
      (Array.isArray(searchParams.commonCore)
        ? searchParams.commonCore
        : searchParams.commonCore
          ? [searchParams.commonCore]
          : []),
  );
  const rawTerm = rankings?.population.termCode ?? first(searchParams, "term");
  const terms =
    rankings?.terms ??
    (rawTerm
      ? [{ termCode: rawTerm, termName: fallbackTermName(rawTerm) }]
      : []);
  return (
    <form
      action={rankingPath(entity)}
      className="w-full space-y-4"
      method="get"
    >
      <div className="flex w-full items-center gap-4">
        <Input
          aria-label={`Search ${label}s`}
          autoComplete="off"
          className="text-md h-12 min-w-0 flex-1 rounded-full focus-visible:ring-gray-700"
          defaultValue={query?.search ?? first(searchParams, "q")}
          id="ranking-search"
          maxLength={100}
          name="q"
          placeholder={
            entity === "course"
              ? "Search for courses by name / instructor / etc…"
              : "Search for instructors by name / course / etc…"
          }
          spellCheck={false}
          type="search"
        />
        <label className="sr-only" htmlFor="ranking-term">
          Term
        </label>
        <select
          className="h-11 w-[10.75rem] shrink-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-700 focus-visible:ring-offset-2"
          defaultValue={rawTerm ?? ""}
          id="ranking-term"
          name="term"
        >
          {terms.length === 0 ? <option value="">Latest Term</option> : null}
          {terms.map((term) => (
            <option key={term.termCode} value={term.termCode}>
              {term.termName}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <div className="space-y-1 p-4">
          {entity === "course" ? (
            <details className="group/filter">
              <summary className="flex min-h-5 cursor-pointer touch-manipulation items-center rounded-sm text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]">
                Filter…
              </summary>
              <div className="grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                <label
                  className="grid gap-1 font-medium"
                  htmlFor="ranking-activity"
                >
                  Activity
                  <select
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-950"
                    defaultValue={
                      query?.activity ??
                      first(searchParams, "activity") ??
                      "current"
                    }
                    id="ranking-activity"
                    name="activity"
                  >
                    <option value="current">Active in this Term</option>
                    <option value="all">Include historical or inactive</option>
                  </select>
                </label>
                <label
                  className="grid gap-1 font-medium"
                  htmlFor="course-prefix"
                >
                  Course Prefix
                  <input
                    autoComplete="off"
                    className="h-11 rounded-md border border-slate-300 px-3 font-normal uppercase"
                    defaultValue={
                      query?.coursePrefix ?? first(searchParams, "prefix")
                    }
                    id="course-prefix"
                    maxLength={8}
                    name="prefix"
                    spellCheck={false}
                  />
                </label>
                <fieldset className="space-y-2 md:col-span-2">
                  <legend className="font-medium">
                    Current Common Core Categories
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {COMMON_CORE_CATEGORIES.map((category) => (
                      <label
                        className="flex min-h-8 items-start gap-2"
                        key={category.value}
                      >
                        <input
                          className="mt-1"
                          defaultChecked={selectedCategories.has(
                            category.value,
                          )}
                          name="commonCore"
                          type="checkbox"
                          value={category.value}
                        />
                        {category.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="md:col-span-2">
                  <ApplyButton>Apply Filters</ApplyButton>
                </div>
              </div>
            </details>
          ) : null}

          <details>
            <summary className="flex min-h-5 cursor-pointer touch-manipulation items-center rounded-sm text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]">
              Score Formula…
            </summary>
            <div className="grid gap-4 border-t border-slate-100 pt-4">
              {entity === "instructor" ? (
                <fieldset className="grid gap-4 md:grid-cols-2">
                  <legend className="mb-2 font-medium">Filters</legend>
                  <label
                    className="grid gap-1 font-medium"
                    htmlFor="ranking-activity"
                  >
                    Activity
                    <select
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-950"
                      defaultValue={
                        query?.activity ??
                        first(searchParams, "activity") ??
                        "current"
                      }
                      id="ranking-activity"
                      name="activity"
                    >
                      <option value="current">Active in this Term</option>
                      <option value="all">
                        Include historical or inactive
                      </option>
                    </select>
                  </label>
                  <label
                    className="grid gap-1 font-medium"
                    htmlFor="course-prefix"
                  >
                    Taught Course Prefix
                    <input
                      autoComplete="off"
                      className="h-11 rounded-md border border-slate-300 px-3 font-normal uppercase"
                      defaultValue={
                        query?.coursePrefix ?? first(searchParams, "prefix")
                      }
                      id="course-prefix"
                      maxLength={8}
                      name="prefix"
                      spellCheck={false}
                    />
                  </label>
                  <label
                    className="grid gap-1 font-medium"
                    htmlFor="instructor-course"
                  >
                    Course Code
                    <input
                      autoComplete="off"
                      className="h-11 rounded-md border border-slate-300 px-3 font-normal uppercase"
                      defaultValue={
                        query?.course ?? first(searchParams, "course")
                      }
                      id="instructor-course"
                      maxLength={15}
                      name="course"
                      spellCheck={false}
                    />
                  </label>
                </fieldset>
              ) : null}
              <label
                className="grid gap-1 font-medium"
                htmlFor="ranking-preset"
              >
                Ranking Preset
                <select
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-950"
                  defaultValue={preset}
                  id="ranking-preset"
                  name="preset"
                >
                  <option value="learning">Learning-focused</option>
                  <option value="grade">Grade-focused</option>
                  <option value="custom">Custom weights</option>
                </select>
              </label>
              <fieldset className="space-y-2">
                <legend className="font-medium">
                  Custom Criterion Weights
                </legend>
                <p className="text-sm text-slate-600">
                  Used only when Custom weights is selected.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {criteria.map(([criterion, criterionLabel]) => (
                    <label className="grid gap-1 text-sm" key={criterion}>
                      {criterionLabel}
                      <input
                        autoComplete="off"
                        className="h-10 rounded-md border border-slate-300 px-3 tabular-nums"
                        defaultValue={
                          preset === "custom"
                            ? first(searchParams, `weight_${criterion}`)
                            : rankings?.configuration.weights[criterion]
                        }
                        inputMode="decimal"
                        min="0"
                        name={`weight_${criterion}`}
                        step="any"
                        type="number"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <ApplyButton>
                  {entity === "instructor"
                    ? "Apply Ranking Settings"
                    : "Apply Score Formula"}
                </ApplyButton>
              </div>
            </div>
          </details>
        </div>
      </Card>
    </form>
  );
}

function RankingChrome({
  entity,
  searchParams,
  query,
  rankings,
  children,
}: {
  entity: Entity;
  searchParams: RankingSearchParams;
  query?: RankingsQuery;
  rankings?: RankingsPage;
  children: ReactNode;
}) {
  const label = entity === "course" ? "Course" : "Instructor";
  const preset = selectedPreset(rankings, query, searchParams);
  const presetLabel =
    preset === "custom"
      ? "Custom weights"
      : `${preset === "grade" ? "Grade" : "Learning"}-focused preset`;
  return (
    <div className="w-full max-w-sm space-y-8 text-left lg:max-w-2xl">
      <NewReleaseBanner className="-mt-12" />
      <header className="text-center">
        <h1 className="text-logo-gradient text-balance text-6xl font-bold tracking-tighter sm:text-7xl">
          UST Rankings
        </h1>
        <p className="sr-only">
          {label} Rankings · {presetLabel}
        </p>
      </header>
      <RankingForm
        entity={entity}
        query={query}
        rankings={rankings}
        searchParams={searchParams}
      />
      {children}
    </div>
  );
}

function RankingAlert({
  title,
  message,
  actionHref,
  actionLabel,
}: {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <section
      className="w-full rounded-xl border border-red-300 bg-red-50 p-6 text-left"
      role="alert"
    >
      <h2 className="text-balance text-2xl font-bold text-slate-900">
        {title}
      </h2>
      <p className="mt-2 text-slate-700">{message}</p>
      {actionHref && actionLabel ? (
        <a
          className="mt-4 inline-block font-semibold text-blue-800 underline"
          href={actionHref}
        >
          {actionLabel}
        </a>
      ) : null}
    </section>
  );
}

export async function RankingPage({
  entity,
  searchParams,
}: {
  entity: Entity;
  searchParams: RankingSearchParams;
}) {
  const label = entity === "course" ? "Course" : "Instructor";
  let query: RankingsQuery | undefined;
  try {
    query = pageQuery(entity, searchParams);
  } catch (error) {
    if (!(error instanceof InvalidRankingsQueryError)) throw error;
    return (
      <RankingChrome entity={entity} searchParams={searchParams}>
        <RankingAlert
          actionHref={rankingPath(entity)}
          actionLabel={`Restart the ${label} rankings`}
          message={error.message}
          title={
            error instanceof StaleRankingsCursorError
              ? "Ranking page expired"
              : "Invalid ranking query"
          }
        />
      </RankingChrome>
    );
  }

  try {
    const rankings = await queryRankings(query);
    return (
      <RankingChrome
        entity={entity}
        query={query}
        rankings={rankings}
        searchParams={searchParams}
      >
        {rankings.results.length > 0 ? (
          <ol
            aria-label={`${label} rankings`}
            className="space-y-3 p-0"
            style={{ listStyle: "none", marginInlineStart: 0 }}
          >
            {rankings.results.map((result) => (
              <RankingResultCard
                key={
                  result.entity === "course" ? result.courseCode : result.uuid
                }
                result={result}
              />
            ))}
          </ol>
        ) : rankings.unrankedMatchCount > 0 ? (
          <p>
            {rankings.unrankedMatchCount} matching {label}
            {rankings.unrankedMatchCount === 1 ? " is" : "s are"} unranked
            because required criterion evidence is missing.
          </p>
        ) : rankings.population.size === 0 ? (
          <p>
            No {label}s have all evidence required by this scoring
            configuration.
          </p>
        ) : rankings.population.filteredSize === 0 ? (
          <p>No eligible {label}s match these structured filters.</p>
        ) : (
          <p>No {label}s in the Local Ranking Population match this search.</p>
        )}
        {rankings.nextCursor ? (
          <a
            className="inline-block rounded-md bg-[#003366] px-5 py-3 font-semibold text-white hover:bg-[#174f82] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
            href={nextPageHref(entity, searchParams, rankings.nextCursor)}
          >
            Next 100 Results
          </a>
        ) : null}
        <p className="sr-only">
          Accepted ranking generation: <code>{rankings.generation}</code>
        </p>
      </RankingChrome>
    );
  } catch (error) {
    if (error instanceof InvalidRankingsQueryError)
      return (
        <RankingChrome
          entity={entity}
          query={query}
          searchParams={searchParams}
        >
          <RankingAlert
            actionHref={rankingPath(entity)}
            actionLabel={`Restart the ${label} rankings`}
            message={error.message}
            title={
              error instanceof StaleRankingsCursorError
                ? "Ranking page expired"
                : "Invalid ranking query"
            }
          />
        </RankingChrome>
      );
    if (!(error instanceof RankingsUnavailableError)) throw error;
    return (
      <RankingChrome entity={entity} query={query} searchParams={searchParams}>
        <section
          className="w-full rounded-xl border border-amber-300 bg-amber-50 p-6 text-left"
          role="alert"
        >
          <h2 className="text-balance text-2xl font-bold text-slate-900">
            {label} rankings are unavailable
          </h2>
          <p className="mt-2 text-slate-700">
            The validated ranking generation could not be loaded. Other public
            pages remain available.
          </p>
        </section>
      </RankingChrome>
    );
  }
}
