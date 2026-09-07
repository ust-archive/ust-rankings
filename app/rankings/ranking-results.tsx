"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import type { RankingsQuery } from "@/lib/rankings/server";

export function RankingPagination({
  fallbackHref,
  initialNextCursor,
  initialPages,
  initialResultCount,
  query,
}: {
  fallbackHref?: string;
  initialNextCursor?: string;
  initialPages: number;
  initialResultCount: number;
  query: RankingsQuery;
}) {
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [pageCount, setPageCount] = useState(initialPages);
  const [resultCount, setResultCount] = useState(initialResultCount);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const loadingCursor = useRef<string | undefined>(undefined);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !nextCursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || loadingCursor.current === nextCursor)
          return;
        loadingCursor.current = nextCursor;
        startTransition(async () => {
          try {
            const nextQuery = { ...query, cursor: nextCursor };
            const page =
              query.entity === "course"
                ? await import("@/lib/browser-query/client").then(
                    async ({ queryCourseRankings }) => {
                      const result = await queryCourseRankings({
                        ...nextQuery,
                        entity: "course",
                      });
                      return {
                        nextCursor: result.nextCursor,
                        results: result.results,
                        termCode: result.population.termCode,
                      };
                    },
                  )
                : await import("@/lib/browser-query/client").then(
                    async ({ queryInstructorRankings }) => {
                      const result = await queryInstructorRankings({
                        ...nextQuery,
                        entity: "instructor",
                      });
                      return {
                        nextCursor: result.nextCursor,
                        results: result.results,
                        termCode: result.population.termCode,
                      };
                    },
                  );
            setResultCount((current) => current + page.results.length);
            setError(false);
            setNextCursor(page.nextCursor);
            const loadedPages = pageCount + 1;
            setPageCount(loadedPages);
            const url = new URL(window.location.href);
            url.searchParams.set("term", page.termCode);
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
    <li className="list-none">
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
          : nextCursor
            ? `${resultCount} rankings loaded. More load automatically while scrolling.`
            : `All ${resultCount} rankings loaded.`}
      </p>
      {fallbackHref ? (
        <noscript>
          <a href={fallbackHref}>Next 100 Results</a>
        </noscript>
      ) : null}
    </li>
  );
}
