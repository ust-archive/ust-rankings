"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadMoreRankings } from "@/app/rankings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type {
  CourseRanking,
  InstructorRanking,
  RankingsPage,
  RankingsQuery,
} from "@/lib/rankings/server";

type Color = [number, number, number];
type Ranking = CourseRanking | InstructorRanking;

const scoreFormat = new Intl.NumberFormat("en", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const countFormat = new Intl.NumberFormat("en");

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
    [0, "F"],
  ] as Array<[number, string]>)
    if (percentile >= threshold) return grade;
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

function luminance(color: Color) {
  return color
    .map((channel) => channel / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    );
}

function gradeForeground(background: Color) {
  return 1.05 / (luminance(background) + 0.05) >= 4.5
    ? "rgb(255, 255, 255)"
    : "rgb(15, 23, 42)";
}

function detailsHref(result: Ranking) {
  return result.entity === "course"
    ? `/courses/${result.coursePrefix}/${result.courseNumber}`
    : `/instructors/${result.itsc ?? result.uuid}`;
}

function sampleCount(value: number, source: string) {
  return `${countFormat.format(value)} ${value === 1 ? "sample" : "samples"} from ${source}`;
}

function RankingResultCard({ result }: { result: Ranking }) {
  const grade = letterGrade(result.globalPercentile);
  const score = scoreFormat.format(result.score * 100);
  const background = gradeColor(result.globalPercentile);
  const hasLocalContext =
    result.localRank !== result.globalRank ||
    result.localPopulation !== result.globalPopulation;
  return (
    <li
      style={{ containIntrinsicSize: "auto 7rem", contentVisibility: "auto" }}
    >
      <Link
        className="group block touch-manipulation rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        href={detailsHref(result)}
        style={{ textDecoration: "none" }}
      >
        <Card className="bg-white transition-shadow hover:border-slate-300 hover:shadow-md group-focus-visible:border-slate-400">
          <CardContent className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 sm:gap-5 sm:p-6">
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
            <Badge
              className="w-12 justify-center rounded-lg border-0 py-2 text-xl shadow-sm sm:text-2xl"
              data-grade={grade}
              style={{
                backgroundColor: `rgb(${background.join(", ")})`,
                color: gradeForeground(background),
              }}
            >
              <span className="sr-only">Grade </span>
              {grade}
            </Badge>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

export function RankingResults({
  initialPage,
  query,
}: {
  initialPage: RankingsPage;
  query: RankingsQuery;
}) {
  const [results, setResults] = useState(initialPage.results);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
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
            const page = await loadMoreRankings({
              ...query,
              cursor: nextCursor,
            });
            setResults((current) => [...current, ...page.results]);
            setNextCursor(page.nextCursor);
            const url = new URL(window.location.href);
            url.searchParams.set("term", page.population.termCode);
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
  }, [nextCursor, query]);

  return (
    <>
      <ol
        aria-label={`${initialPage.population.entity === "course" ? "Course" : "Instructor"} rankings`}
        className="flex list-none flex-col gap-3 p-0"
        style={{ listStyle: "none", marginInlineStart: 0 }}
      >
        {results.map((result) => (
          <RankingResultCard
            key={result.entity === "course" ? result.courseCode : result.uuid}
            result={result}
          />
        ))}
      </ol>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>More rankings could not be loaded</AlertTitle>
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
            ? "More rankings load automatically while scrolling."
            : "All rankings loaded."}
      </p>
    </>
  );
}
