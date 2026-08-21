"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadMoreRankings } from "@/app/rankings/actions";
import { RankingResultCard } from "@/app/rankings/ranking-result-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import type {
  CourseRanking,
  InstructorRanking,
  RankingsQuery,
} from "@/lib/rankings/server";

type Ranking = CourseRanking | InstructorRanking;

export function RankingResults({
  children,
  entity,
  fallbackHref,
  initialNextCursor,
  initialPages,
  query,
}: {
  children: ReactNode;
  entity: "course" | "instructor";
  fallbackHref?: string;
  initialNextCursor?: string;
  initialPages: number;
  query: RankingsQuery;
}) {
  const [additionalResults, setAdditionalResults] = useState<Ranking[]>([]);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [pageCount, setPageCount] = useState(initialPages);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const loadingCursor = useRef<string | undefined>(undefined);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !nextCursor || pageCount >= 100) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || loadingCursor.current === nextCursor)
          return;
        loadingCursor.current = nextCursor;
        startTransition(async () => {
          try {
            const page = await loadMoreRankings({
              ...query,
              cursor: nextCursor,
            });
            setAdditionalResults((current) => [...current, ...page.results]);
            setNextCursor(page.nextCursor);
            const loadedPages = pageCount + 1;
            setPageCount(loadedPages);
            const url = new URL(window.location.href);
            url.searchParams.set("term", page.population.termCode);
            url.searchParams.set("pages", String(loadedPages));
            url.searchParams.set("cursor", nextCursor);
            window.history.replaceState(null, "", url);
          } catch {
            setError(true);
          } finally {
            loadingCursor.current = undefined;
          }
        });
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nextCursor, pageCount, query]);

  return (
    <>
      <ol
        aria-label={`${entity === "course" ? "Course" : "Instructor"} rankings`}
        className="flex list-none flex-col gap-3 p-0"
        style={{ listStyle: "none", marginInlineStart: 0 }}
      >
        {children}
        {additionalResults.map((result) => (
          <RankingResultCard
            key={result.entity === "course" ? result.courseCode : result.uuid}
            result={result}
          />
        ))}
      </ol>
      {error ? (
        <Alert variant="destructive">
          <h2 className="font-medium leading-none tracking-tight">
            More rankings could not be loaded
          </h2>
          <AlertDescription>
            Reload the page to continue from the current cursor.
          </AlertDescription>
        </Alert>
      ) : null}
      <div aria-hidden="true" className="h-px" ref={sentinel} />
      {isPending ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-600">
          <Spinner aria-hidden="true" />
          Loading more rankings…
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {isPending
          ? "Loading more rankings…"
          : nextCursor && pageCount < 100
            ? "More rankings load automatically while scrolling."
            : "All available rankings loaded."}
      </p>
      {fallbackHref ? (
        <noscript>
          <a href={fallbackHref}>Next 100 Results</a>
        </noscript>
      ) : null}
    </>
  );
}
