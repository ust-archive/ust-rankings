import Link from "next/link";
import { coursePath } from "@/app/courses/routes";
import {
  COMMON_CORE_CATEGORIES,
  type CommonCoreCategory,
  InvalidRankingsQueryError,
  queryRankings,
  type RankingsQuery,
  RankingsUnavailableError,
  StaleRankingsCursorError,
} from "@/lib/rankings/server";

type Entity = "course" | "instructor";
export type RankingSearchParams = Record<string, string | string[] | undefined>;

const criteria = [
  ["content", "Content"],
  ["teaching", "Teaching"],
  ["grading", "Grading"],
  ["workload", "Workload"],
  ["course", "Course SFQ"],
  ["instructor", "Instructor SFQ"],
] as const;

function single(
  searchParams: RankingSearchParams,
  name: string,
): string | undefined {
  const value = searchParams[name];
  if (Array.isArray(value))
    throw new InvalidRankingsQueryError(`${name} must occur once.`);
  return value;
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
  return `/rankings/${entity === "course" ? "courses" : "instructors"}?${next}`;
}

function InvalidState({ error, entity }: { error: Error; entity: Entity }) {
  const label = entity === "course" ? "Course" : "Instructor";
  const stale = error instanceof StaleRankingsCursorError;
  return (
    <section
      className="w-full rounded-xl border border-red-300 bg-red-50 p-6 text-left"
      role="alert"
    >
      <h1 className="text-2xl font-bold text-slate-900">
        {stale ? "Ranking page expired" : "Invalid ranking query"}
      </h1>
      <p className="mt-2 text-slate-700">{error.message}</p>
      <a
        className="mt-4 inline-block font-semibold text-blue-800 underline"
        href={`/rankings/${entity === "course" ? "courses" : "instructors"}`}
      >
        Restart the {label} rankings
      </a>
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
  try {
    const query = pageQuery(entity, searchParams);
    const rankings = await queryRankings(query);
    const label = entity === "course" ? "Course" : "Instructor";
    const selectedCategories = new Set(query.commonCore ?? []);
    const selectedPreset = query.weights
      ? "custom"
      : (query.preset ?? "learning");

    return (
      <div className="w-full space-y-8 text-left">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-800">
            {rankings.configuration.preset === "custom"
              ? "Custom weights"
              : `${rankings.configuration.preset === "grade" ? "Grade" : "Learning"}-focused preset`}
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            {label} Rankings
          </h1>
          <p className="text-slate-600">
            {rankings.population.termCode} · {rankings.population.size} eligible{" "}
            {label}s · {rankings.population.filteredSize} in the Local Ranking
            Population
          </p>
        </header>

        <form
          className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2"
          action={`/rankings/${entity === "course" ? "courses" : "instructors"}`}
          method="get"
        >
          <label className="grid gap-1 font-medium" htmlFor="ranking-search">
            Search {label}s
            <input
              className="h-11 rounded-md border border-slate-300 px-3 font-normal"
              id="ranking-search"
              name="q"
              type="search"
              maxLength={100}
              defaultValue={query.search}
            />
          </label>
          <label className="grid gap-1 font-medium" htmlFor="ranking-term">
            Term Code
            <input
              className="h-11 rounded-md border border-slate-300 px-3 font-normal"
              id="ranking-term"
              name="term"
              inputMode="numeric"
              pattern="[0-9]{4}"
              defaultValue={rankings.population.termCode}
            />
          </label>
          <label className="grid gap-1 font-medium" htmlFor="ranking-preset">
            Ranking Preset
            <select
              className="h-11 rounded-md border border-slate-300 px-3 font-normal"
              id="ranking-preset"
              name="preset"
              defaultValue={selectedPreset}
            >
              <option value="learning">Learning-focused</option>
              <option value="grade">Grade-focused</option>
              <option value="custom">Custom weights</option>
            </select>
          </label>
          <label className="grid gap-1 font-medium" htmlFor="ranking-activity">
            Activity
            <select
              className="h-11 rounded-md border border-slate-300 px-3 font-normal"
              id="ranking-activity"
              name="activity"
              defaultValue={query.activity ?? "current"}
            >
              <option value="current">Active in this Term</option>
              <option value="all">Include historical or inactive</option>
            </select>
          </label>
          <label className="grid gap-1 font-medium" htmlFor="course-prefix">
            {entity === "course" ? "Course Prefix" : "Taught Course Prefix"}
            <input
              className="h-11 rounded-md border border-slate-300 px-3 font-normal uppercase"
              id="course-prefix"
              name="prefix"
              maxLength={8}
              defaultValue={query.coursePrefix}
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
                id="instructor-course"
                name="course"
                placeholder="COMP 1000"
                maxLength={15}
                defaultValue={query.course}
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
                      type="checkbox"
                      name="commonCore"
                      value={category.value}
                      defaultChecked={selectedCategories.has(category.value)}
                    />
                    {category.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="font-medium">
              Custom criterion weights (used when Custom weights is selected)
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {criteria.map(([criterion, criterionLabel]) => (
                <label className="grid gap-1 text-sm" key={criterion}>
                  {criterionLabel}
                  <input
                    className="h-10 rounded-md border border-slate-300 px-3"
                    type="number"
                    name={`weight_${criterion}`}
                    min="0"
                    step="any"
                    defaultValue={
                      selectedPreset === "custom"
                        ? single(searchParams, `weight_${criterion}`)
                        : rankings.configuration.weights[criterion]
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="rounded-md bg-[#003366] px-5 py-3 font-semibold text-white md:col-span-2"
            type="submit"
          >
            Apply ranking configuration
          </button>
        </form>

        {rankings.results.length > 0 ? (
          <ol className="space-y-3" aria-label={`${label} rankings`}>
            {rankings.results.map((result) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                key={
                  result.entity === "course" ? result.courseCode : result.uuid
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-semibold text-slate-900">
                    {result.entity === "course" ? (
                      <Link
                        href={coursePath(
                          result.coursePrefix,
                          result.courseNumber,
                        )}
                      >
                        {result.courseCode}
                        {result.title ? ` · ${result.title}` : ""}
                      </Link>
                    ) : (
                      result.canonicalName
                    )}
                  </h2>
                  <strong>
                    Global Rank {result.globalRank} of {result.globalPopulation}
                  </strong>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Score {result.score.toFixed(4)} · Local Rank{" "}
                  {result.localRank} of {result.localPopulation} · Global
                  percentile {(result.globalPercentile * 100).toFixed(1)}% ·
                  Local percentile {(result.localPercentile * 100).toFixed(1)}%
                </p>
              </li>
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

        {rankings.nextCursor && (
          <a
            className="inline-block rounded-md bg-[#003366] px-5 py-3 font-semibold text-white"
            href={nextPageHref(entity, searchParams, rankings.nextCursor)}
          >
            Next 100 results
          </a>
        )}
        <footer className="break-all text-xs text-slate-500">
          Accepted ranking generation: <code>{rankings.generation}</code>
        </footer>
      </div>
    );
  } catch (error) {
    if (error instanceof InvalidRankingsQueryError)
      return <InvalidState error={error} entity={entity} />;
    if (!(error instanceof RankingsUnavailableError)) throw error;
    const label = entity === "course" ? "Course" : "Instructor";
    return (
      <section
        className="w-full rounded-xl border border-amber-300 bg-amber-50 p-6 text-left"
        role="alert"
      >
        <h1 className="text-2xl font-bold text-slate-900">
          {label} rankings are unavailable
        </h1>
        <p className="mt-2 text-slate-700">
          The validated ranking generation could not be loaded. Other public
          pages remain available.
        </p>
      </section>
    );
  }
}
