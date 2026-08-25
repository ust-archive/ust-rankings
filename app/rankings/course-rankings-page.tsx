"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type CourseRankingSearchParams,
  courseRankingPages,
  courseRankingQuery,
  InvalidCourseRankingQueryError,
} from "@/app/rankings/course-query";
import { RankingControls } from "@/app/rankings/ranking-controls";
import { RankingResultCard } from "@/app/rankings/ranking-result-card";
import { RankingPagination } from "@/app/rankings/ranking-results";
import { Announcement } from "@/components/component/announcement";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  cachedCourseRankings,
  queryCourseRankingPages,
} from "@/lib/browser-query/client";
import type { RankingPreference } from "@/lib/rankings/preference";
import { rankingTermName } from "@/lib/rankings/presentation";
import type {
  CommonCoreSchemeDefinition,
  RankingsPage,
  RankingsQuery,
} from "@/lib/rankings/server";
import { rankingSearchParams } from "@/lib/rankings/url";

function nextPageHref(
  searchParams: CourseRankingSearchParams,
  cursor: string,
  termCode: string,
  pages: number,
) {
  const next = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (["cursor", "pages"].includes(name) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      next.append(name, item);
  }
  next.set("term", termCode);
  next.set("pages", String(pages + 1));
  next.set("cursor", cursor);
  return `/rankings/courses?${next}`;
}

function RankingAlert({
  title,
  message,
  restart = false,
}: {
  title: string;
  message: string;
  restart?: boolean;
}) {
  return (
    <Alert className="p-6" variant={restart ? "destructive" : "default"}>
      <h2 className="text-balance text-2xl font-bold">{title}</h2>
      <AlertDescription>{message}</AlertDescription>
      {restart ? (
        <Button asChild className="mt-4" variant="outline">
          <a href="/rankings/courses">Restart the Course rankings</a>
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

function selectedPreset(
  rankings: RankingsPage<"course"> | undefined,
  query: RankingsQuery & { entity: "course" },
) {
  if (rankings) return rankings.configuration.preset;
  if (query.weights) return "custom";
  return query.preset === "grade" ? "grade" : "learning";
}

export function CourseRankingsPage({
  preference,
  schemes,
}: {
  preference: RankingPreference;
  schemes: ReadonlyArray<CommonCoreSchemeDefinition>;
}) {
  const currentSearchParams = useSearchParams();
  const searchParams = useMemo(
    () => rankingSearchParams(currentSearchParams) as CourseRankingSearchParams,
    [currentSearchParams],
  );
  const parsed = useMemo(() => {
    try {
      const query = courseRankingQuery(searchParams, preference);
      return { query, pages: courseRankingPages(searchParams) };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Invalid ranking query.",
      };
    }
  }, [preference, searchParams]);
  const query = parsed.query;
  const queryKey = query
    ? `${JSON.stringify(query)}:${parsed.pages}`
    : "invalid";
  const initial = query ? cachedCourseRankings(query) : undefined;
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    rankings?: RankingsPage<"course">;
    error?: "invalid" | "unavailable";
    message?: string;
  }>(() => ({
    key: queryKey,
    loading: Boolean(query) && !initial,
    rankings: initial,
  }));

  useEffect(() => {
    if (!query) {
      setState({
        key: queryKey,
        loading: false,
        error: "invalid",
        message: parsed.error,
      });
      return;
    }
    let current = true;
    setState((previous) => ({ ...previous, key: queryKey, loading: true }));
    void queryCourseRankingPages(query, parsed.pages ?? 1).then(
      (rankings) => {
        if (current) setState({ key: queryKey, loading: false, rankings });
      },
      (error) => {
        if (!current) return;
        const invalid =
          error instanceof InvalidCourseRankingQueryError ||
          (error instanceof Error &&
            /invalid|unknown|expired|cursor/i.test(error.message));
        setState({
          key: queryKey,
          loading: false,
          error: invalid ? "invalid" : "unavailable",
          message:
            invalid && error instanceof Error ? error.message : undefined,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [parsed.error, parsed.pages, query, queryKey]);

  const current = state.key === queryKey ? state : { ...state, loading: true };
  const rankings = current.rankings;
  const preset = selectedPreset(
    rankings,
    query ?? ({ entity: "course" } as RankingsQuery & { entity: "course" }),
  );
  const commonCore = query?.commonCore ?? [];
  const termCode = rankings?.population.termCode ?? query?.termCode ?? "";
  const terms =
    rankings?.terms ??
    (termCode ? [{ termCode, termName: rankingTermName(termCode) }] : []);
  const initialControls = {
    activity: query?.activity ?? "current",
    commonCore,
    commonCoreScheme: query?.commonCoreScheme ?? "CC25",
    preset,
    search: query?.search ?? "",
    termCode,
    weights: { ...rankings?.configuration.weights, ...query?.weights },
  } as const;
  const restoredPages = rankings
    ? Math.max(1, Math.ceil(rankings.results.length / 100))
    : 1;

  return (
    <div className="flex w-full max-w-sm flex-col gap-8 text-left lg:max-w-2xl">
      <header className="text-center">
        <h1 className="text-logo-gradient text-balance text-6xl font-bold tracking-tighter sm:text-7xl">
          UST Rankings
        </h1>
        <p className="sr-only">Course Rankings</p>
      </header>
      <Announcement />
      <RankingControls
        entity="course"
        initial={initialControls}
        key={JSON.stringify({ ...initialControls, search: undefined })}
        schemes={schemes}
        terms={terms}
      />
      {current.loading && !rankings ? (
        <Alert aria-live="polite" className="p-6">
          <div className="flex items-center gap-3">
            <Spinner aria-hidden="true" />
            <h2 className="text-xl font-bold">Loading Course rankings…</h2>
          </div>
          <AlertDescription>
            Catalog and Ranking data are loading in this tab.
          </AlertDescription>
        </Alert>
      ) : current.error === "invalid" ? (
        <RankingAlert
          message={current.message ?? "The ranking query is invalid."}
          restart
          title="Invalid ranking query"
        />
      ) : current.error === "unavailable" ? (
        <RankingAlert
          message="Public Course data could not be loaded. Static identity and Community features remain available."
          title="Course rankings are unavailable"
        />
      ) : rankings ? (
        rankings.results.length > 0 ? (
          <ol
            aria-busy={current.loading}
            aria-label="Course rankings"
            className="flex list-none flex-col gap-3 p-0"
            style={{ listStyle: "none", marginInlineStart: 0 }}
          >
            {rankings.results.map((result) => (
              <RankingResultCard key={result.courseCode} result={result} />
            ))}
            <RankingPagination
              fallbackHref={
                rankings.nextCursor
                  ? nextPageHref(
                      searchParams,
                      rankings.nextCursor,
                      rankings.population.termCode,
                      restoredPages,
                    )
                  : undefined
              }
              initialNextCursor={rankings.nextCursor}
              initialPages={restoredPages}
              initialResultCount={rankings.results.length}
              key={JSON.stringify(query)}
              query={query as RankingsQuery}
            />
          </ol>
        ) : rankings.unrankedMatchCount > 0 ? (
          <RankingEmpty>
            {rankings.unrankedMatchCount} matching Course
            {rankings.unrankedMatchCount === 1 ? " is" : "s are"} unranked
            because required criterion evidence is missing.
          </RankingEmpty>
        ) : rankings.population.size === 0 ? (
          <RankingEmpty>
            No Courses have all evidence required by this scoring configuration.
          </RankingEmpty>
        ) : rankings.population.filteredSize === 0 ? (
          <RankingEmpty>
            No eligible Courses match these structured filters.
          </RankingEmpty>
        ) : (
          <RankingEmpty>
            No Courses matching the structured filters match this search.
          </RankingEmpty>
        )
      ) : null}
      <p className="sr-only" role="status">
        {current.loading
          ? "Updating Course rankings…"
          : `Showing ${rankings?.results.length ?? 0} Course ranking results.`}
      </p>
      {rankings ? (
        <p className="sr-only">
          Pinned public generation: <code>{rankings.generation}</code>
        </p>
      ) : null}
    </div>
  );
}
