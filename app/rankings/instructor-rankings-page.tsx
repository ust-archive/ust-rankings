"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type InstructorRankingSearchParams,
  instructorRankingPages,
  instructorRankingQuery,
} from "@/app/rankings/instructor-query";
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
  cachedInstructorRankings,
  preloadPublicQuery,
  queryInstructorRankingPages,
} from "@/lib/browser-query/client";
import type { RankingPreference } from "@/lib/rankings/preference";
import { rankingTermName } from "@/lib/rankings/presentation";
import type { RankingsPage, RankingsQuery } from "@/lib/rankings/server";
import { rankingSearchParams } from "@/lib/rankings/url";

function nextPageHref(
  searchParams: InstructorRankingSearchParams,
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
  return `/rankings/instructors?${next}`;
}

function Message({
  children,
  title,
  restart = false,
}: {
  children: ReactNode;
  title: string;
  restart?: boolean;
}) {
  return (
    <Alert className="p-6" variant={restart ? "destructive" : "default"}>
      <h2 className="text-balance text-2xl font-bold">{title}</h2>
      <AlertDescription>{children}</AlertDescription>
      {restart ? (
        <Button asChild className="mt-4" variant="outline">
          <a href="/rankings/instructors">Restart the Instructor rankings</a>
        </Button>
      ) : null}
    </Alert>
  );
}

function EmptyRankings({ children }: { children: ReactNode }) {
  return (
    <Empty className="border bg-white">
      <EmptyHeader>
        <EmptyTitle>No Rankings Found</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function InstructorRankingsPage({
  preference,
}: {
  preference: RankingPreference;
}) {
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const searchParams = useMemo(
    () =>
      rankingSearchParams(currentSearchParams) as InstructorRankingSearchParams,
    [currentSearchParams],
  );
  const parsed = useMemo(() => {
    try {
      return {
        pages: instructorRankingPages(searchParams),
        query: instructorRankingQuery(searchParams, preference),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid query.",
      };
    }
  }, [preference, searchParams]);
  const query = parsed.query;
  const queryKey = query
    ? `${JSON.stringify(query)}:${parsed.pages}`
    : "invalid";
  const initial = query ? cachedInstructorRankings(query) : undefined;
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    rankings?: RankingsPage<"instructor">;
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
    void queryInstructorRankingPages(query, parsed.pages ?? 1).then(
      (rankings) => {
        if (current) setState({ key: queryKey, loading: false, rankings });
      },
      (error) => {
        if (!current) return;
        const invalid =
          error instanceof Error &&
          /invalid|unknown|expired|cursor/i.test(error.message);
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
  useEffect(() => {
    if (!rankings) return;
    router.prefetch("/rankings/courses");
    void preloadPublicQuery("/rankings/courses").catch(() => undefined);
  }, [rankings, router]);
  const preset =
    rankings?.configuration.preset ??
    (query?.weights ? "custom" : (query?.preset ?? "learning"));
  const termCode = rankings?.population.termCode ?? query?.termCode ?? "";
  const terms =
    rankings?.terms ??
    (termCode ? [{ termCode, termName: rankingTermName(termCode) }] : []);
  const controls = {
    activity: query?.activity ?? "current",
    commonCore: [],
    commonCoreScheme: "CC25" as const,
    preset,
    search: query?.search ?? "",
    termCode,
    weights: { ...rankings?.configuration.weights, ...query?.weights },
  };
  const pages = rankings
    ? Math.max(1, Math.ceil(rankings.results.length / 100))
    : 1;
  return (
    <div className="flex w-full max-w-sm flex-col gap-8 text-left lg:max-w-2xl">
      <header className="text-center">
        <h1 className="text-logo-gradient text-balance text-6xl font-bold tracking-tighter sm:text-7xl">
          UST Rankings
        </h1>
        <p className="sr-only">Instructor Rankings</p>
      </header>
      <Announcement />
      <RankingControls
        entity="instructor"
        initial={controls}
        key={JSON.stringify({ ...controls, search: undefined })}
        schemes={[]}
        terms={terms}
      />
      {current.loading && !rankings ? (
        <Alert aria-live="polite" className="p-6">
          <div className="flex items-center gap-3">
            <Spinner aria-hidden="true" />
            <h2 className="text-xl font-bold">Loading Instructor rankings…</h2>
          </div>
          <AlertDescription>
            Identity and Ranking data are loading in this tab.
          </AlertDescription>
        </Alert>
      ) : current.error === "invalid" ? (
        <Message restart title="Invalid ranking query">
          {current.message}
        </Message>
      ) : current.error === "unavailable" ? (
        <Message title="Instructor rankings are unavailable">
          Public Instructor data could not be loaded. Static identity and
          Community features remain available.
        </Message>
      ) : rankings?.results.length ? (
        <ol
          aria-busy={current.loading}
          aria-label="Instructor rankings"
          className="flex list-none flex-col gap-3 p-0"
          style={{ listStyle: "none", marginInlineStart: 0 }}
        >
          {rankings.results.map((result) => (
            <RankingResultCard key={result.uuid} result={result} />
          ))}
          <RankingPagination
            fallbackHref={
              rankings.nextCursor
                ? nextPageHref(
                    searchParams,
                    rankings.nextCursor,
                    rankings.population.termCode,
                    pages,
                  )
                : undefined
            }
            initialNextCursor={rankings.nextCursor}
            initialPages={pages}
            initialResultCount={rankings.results.length}
            key={JSON.stringify(query)}
            query={query as RankingsQuery}
          />
        </ol>
      ) : rankings ? (
        <EmptyRankings>
          {rankings.unrankedMatchCount > 0
            ? `${rankings.unrankedMatchCount} matching Instructors are unranked because required criterion evidence is missing.`
            : rankings.population.filteredSize === 0
              ? "No eligible Instructors match these structured filters."
              : "No Instructors match this search."}
        </EmptyRankings>
      ) : null}
      <p className="sr-only" role="status">
        {current.loading
          ? "Updating Instructor rankings…"
          : `Showing ${rankings?.results.length ?? 0} Instructor ranking results.`}
      </p>
    </div>
  );
}
