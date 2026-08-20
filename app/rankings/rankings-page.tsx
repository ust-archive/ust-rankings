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
  const colorStops = [
    { ratio: 0.0, color: [237, 27, 47] as Color },
    { ratio: 0.25, color: [250, 166, 26] as Color },
    { ratio: 0.75, color: [163, 207, 98] as Color },
    { ratio: 1.0, color: [0, 154, 97] as Color },
  ];
  for (let i = 0; i < colorStops.length - 1; i++) {
    const currentStop = colorStops[i];
    const nextStop = colorStops[i + 1];
    if (ratio >= currentStop.ratio && ratio <= nextStop.ratio) {
      const t =
        (ratio - currentStop.ratio) / (nextStop.ratio - currentStop.ratio);
      return [
        Math.round(currentStop.color[0] * (1 - t) + nextStop.color[0] * t),
        Math.round(currentStop.color[1] * (1 - t) + nextStop.color[1] * t),
        Math.round(currentStop.color[2] * (1 - t) + nextStop.color[2] * t),
      ];
    }
  }
  return [0, 0, 0];
}

function detailsHref(result: CourseRanking | InstructorRanking) {
  return result.entity === "course"
    ? coursePath(result.coursePrefix, result.courseNumber)
    : instructorPath(result);
}

function RankingResultCard({
  result,
}: {
  result: CourseRanking | InstructorRanking;
}) {
  const grade = letterGrade(result.globalPercentile);
  const identity =
    result.entity === "course"
      ? `${result.courseCode}${result.title ? ` · ${result.title}` : ""}`
      : result.canonicalName;
  return (
    <li>
      <Link
        className="group block rounded-lg no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        href={detailsHref(result)}
      >
        <Card className="flex flex-col bg-white">
          <div className="flex w-full flex-row flex-wrap items-center gap-4 p-4 lg:p-6 lg:pr-10">
            <p className="shrink-0 text-2xl font-semibold text-gray-600 lg:w-36">
              #{result.localRank}{" "}
              <span className="font-medium">
                ({(result.score * 100).toFixed(1)})
              </span>
            </p>
            <div className="min-w-0 flex-1 space-y-1 text-left">
              <h2 className="text-2xl font-semibold tracking-normal wrap-break-word group-hover:underline">
                {identity}
              </h2>
              <p className="text-sm text-gray-500">
                Global Rank {result.globalRank} of {result.globalPopulation} ·
                Local Rank {result.localRank} of {result.localPopulation}
              </p>
            </div>
            <div
              className="my-auto ml-auto w-12 shrink-0 rounded-lg py-2 text-center text-2xl font-semibold text-white"
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
  return (
    <form
      action={rankingPath(entity)}
      className="w-full space-y-4"
      method="get"
    >
      <div className="flex w-full flex-wrap items-center gap-4">
        <Input
          aria-label={`Search ${label}s`}
          className="text-md h-12 min-w-[10rem] flex-1 rounded-full focus-visible:ring-gray-700"
          defaultValue={query?.search ?? first(searchParams, "q")}
          id="ranking-search"
          maxLength={100}
          name="q"
          placeholder={
            entity === "course"
              ? "Search for courses by name / instructor / etc."
              : "Search for instructors by name / course / etc."
          }
          type="search"
        />
        <Input
          aria-label="Term"
          className="h-12 w-[7.5rem] shrink-0 focus-visible:ring-gray-700"
          defaultValue={
            rankings?.population.termCode ?? first(searchParams, "term")
          }
          id="ranking-term"
          inputMode="numeric"
          name="term"
          pattern="[0-9]{4}"
        />
      </div>
      <Card>
        <div className="relative space-y-2 p-4">
          <details className="space-y-2">
            <summary className="cursor-pointer text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]">
              Settings...
            </summary>
            <div className="grid gap-4 pt-2 md:grid-cols-2">
              <label
                className="grid gap-1 font-medium"
                htmlFor="ranking-preset"
              >
                Ranking Preset
                <select
                  className="h-11 rounded-md border border-slate-300 px-3 font-normal"
                  defaultValue={preset}
                  id="ranking-preset"
                  name="preset"
                >
                  <option value="learning">Learning-focused</option>
                  <option value="grade">Grade-focused</option>
                  <option value="custom">Custom weights</option>
                </select>
              </label>
              <label
                className="grid gap-1 font-medium"
                htmlFor="ranking-activity"
              >
                Activity
                <select
                  className="h-11 rounded-md border border-slate-300 px-3 font-normal"
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
              <label className="grid gap-1 font-medium" htmlFor="course-prefix">
                {entity === "course" ? "Course Prefix" : "Taught Course Prefix"}
                <input
                  className="h-11 rounded-md border border-slate-300 px-3 font-normal uppercase"
                  defaultValue={
                    query?.coursePrefix ?? first(searchParams, "prefix")
                  }
                  id="course-prefix"
                  maxLength={8}
                  name="prefix"
                />
              </label>
              {entity === "instructor" && (
                <label
                  className="grid gap-1 font-medium"
                  htmlFor="instructor-course"
                >
                  Course Code
                  <input
                    className="h-11 rounded-md border border-slate-300 px-3 font-normal uppercase"
                    defaultValue={
                      query?.course ?? first(searchParams, "course")
                    }
                    id="instructor-course"
                    maxLength={15}
                    name="course"
                    placeholder="COMP 1000"
                  />
                </label>
              )}
              {entity === "course" && (
                <fieldset className="space-y-2 md:col-span-2">
                  <legend className="font-medium">
                    Current Common Core categories
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {COMMON_CORE_CATEGORIES.map((category) => (
                      <label className="flex gap-2" key={category.value}>
                        <input
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
              )}
              <fieldset className="space-y-2 md:col-span-2">
                <legend className="font-medium">
                  Custom criterion weights (used when Custom weights is
                  selected)
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {criteria.map(([criterion, criterionLabel]) => (
                    <label className="grid gap-1 text-sm" key={criterion}>
                      {criterionLabel}
                      <input
                        className="h-10 rounded-md border border-slate-300 px-3"
                        defaultValue={
                          preset === "custom"
                            ? first(searchParams, `weight_${criterion}`)
                            : rankings?.configuration.weights[criterion]
                        }
                        min="0"
                        name={`weight_${criterion}`}
                        step="any"
                        type="number"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                className="rounded-md bg-[#003366] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366] md:col-span-2"
                type="submit"
              >
                Apply ranking configuration
              </button>
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
      : preset === "grade"
        ? "Grade-focused preset"
        : "Learning-focused preset";
  return (
    <div className="w-full max-w-sm space-y-8 text-left lg:max-w-3xl">
      <NewReleaseBanner className="-mt-12" />
      <header className="space-y-2">
        <h1 className="text-logo-gradient max-w-sm text-6xl font-bold tracking-tighter sm:text-7xl lg:max-w-2xl">
          UST Rankings
        </h1>
        <p className="text-slate-600">
          {label} Rankings · {presetLabel}
        </p>
        {rankings ? (
          <p className="text-slate-600">
            {rankings.population.termCode} · {rankings.population.size} eligible{" "}
            {label}s · {rankings.population.filteredSize} in the Local Ranking
            Population
          </p>
        ) : null}
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
      <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
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
          <ol aria-label={`${label} rankings`} className="space-y-3">
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
            className="inline-block rounded-md bg-[#003366] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
            href={nextPageHref(entity, searchParams, rankings.nextCursor)}
          >
            Next 100 results
          </a>
        ) : null}
        <footer className="break-all text-xs text-slate-500">
          Accepted ranking generation: <code>{rankings.generation}</code>
        </footer>
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
          <h2 className="text-2xl font-bold text-slate-900">
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
