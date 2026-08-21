import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  COMMON_CORE_CATEGORIES,
  type CommonCoreCategory,
  InvalidRankingsQueryError,
  queryRankings,
  type RankingsPage,
  type RankingsQuery,
  RankingsUnavailableError,
  rankingTermName,
  StaleRankingsCursorError,
} from "@/lib/rankings/server";
import { RankingControls } from "./ranking-controls";
import { RankingResults } from "./ranking-results";

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

function selectedPreset(
  rankings: RankingsPage | undefined,
  query: RankingsQuery | undefined,
  searchParams: RankingSearchParams,
): "learning" | "grade" | "custom" {
  if (rankings) return rankings.configuration.preset;
  if (query?.weights) return "custom";
  return (query?.preset ?? first(searchParams, "preset")) === "grade"
    ? "grade"
    : "learning";
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
  const preset = selectedPreset(rankings, query, searchParams);
  const commonCore =
    query?.commonCore ??
    (Array.isArray(searchParams.commonCore)
      ? searchParams.commonCore
      : searchParams.commonCore
        ? [searchParams.commonCore]
        : []);
  const termCode =
    rankings?.population.termCode ?? first(searchParams, "term") ?? "";
  const terms =
    rankings?.terms ??
    (termCode ? [{ termCode, termName: rankingTermName(termCode) }] : []);
  const initial = {
    activity: query?.activity ?? "current",
    commonCore,
    course: query?.course ?? first(searchParams, "course") ?? "",
    prefix: query?.coursePrefix ?? first(searchParams, "prefix") ?? "",
    preset,
    search: query?.search ?? first(searchParams, "q") ?? "",
    termCode,
    weights: {
      ...rankings?.configuration.weights,
      ...query?.weights,
    },
  };
  return (
    <RankingControls
      categories={COMMON_CORE_CATEGORIES}
      entity={entity}
      initial={initial}
      key={JSON.stringify(initial)}
      terms={terms}
    />
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
        ? "Grading-Focus'd preset"
        : "Knowledge-Focus'd preset";
  return (
    <div className="flex w-full max-w-sm flex-col gap-8 text-left lg:max-w-2xl">
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
    <Alert className="p-6" variant="destructive">
      <AlertTitle className="text-balance text-2xl font-bold">
        {title}
      </AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {actionHref && actionLabel ? (
        <Button asChild className="mt-4" variant="outline">
          <a href={actionHref}>{actionLabel}</a>
        </Button>
      ) : null}
    </Alert>
  );
}

function RankingEmpty({ children }: { children: ReactNode }) {
  return (
    <Empty className="border bg-white">
      <EmptyHeader>
        <EmptyTitle>No Rankings Found</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
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
          <RankingResults
            initialPage={rankings}
            key={JSON.stringify(query)}
            query={query}
          />
        ) : rankings.unrankedMatchCount > 0 ? (
          <RankingEmpty>
            {rankings.unrankedMatchCount} matching {label}
            {rankings.unrankedMatchCount === 1 ? " is" : "s are"} unranked
            because required criterion evidence is missing.
          </RankingEmpty>
        ) : rankings.population.size === 0 ? (
          <RankingEmpty>
            No {label}s have all evidence required by this scoring
            configuration.
          </RankingEmpty>
        ) : rankings.population.filteredSize === 0 ? (
          <RankingEmpty>
            No eligible {label}s match these structured filters.
          </RankingEmpty>
        ) : (
          <RankingEmpty>
            No {label}s in the Local Ranking Population match this search.
          </RankingEmpty>
        )}
        <p className="sr-only" role="status">
          Showing {rankings.results.length} {label} ranking results.
        </p>
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
        <Alert className="p-6">
          <AlertTitle className="text-balance text-2xl font-bold">
            {label} rankings are unavailable
          </AlertTitle>
          <AlertDescription>
            The validated ranking generation could not be loaded. Other public
            pages remain available.
          </AlertDescription>
        </Alert>
      </RankingChrome>
    );
  }
}
