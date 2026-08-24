"use client";

import {
  parseRankingPreference,
  RANKING_PREFERENCE_COOKIE,
  rankingPreferenceQuery,
} from "@/lib/rankings/preference";
import type {
  CourseRankings,
  RankingsPage,
  RankingsQuery,
} from "@/lib/rankings/server";
import type { CourseQueryOperations } from "./protocol";

type Operation = keyof CourseQueryOperations;
type Entry = { promise: Promise<unknown>; value?: unknown };
const cache = new Map<string, Entry>();

function key(operation: Operation, input: unknown) {
  return `${operation}:${JSON.stringify(input)}`;
}

async function execute<Selected extends Operation>(
  operation: Selected,
  input: CourseQueryOperations[Selected]["input"],
): Promise<CourseQueryOperations[Selected]["output"]> {
  const runtime = await import("./runtime");
  let output: unknown;
  if (operation === "catalog")
    output = await runtime.queryCatalog(
      input as CourseQueryOperations["catalog"]["input"],
    );
  else if (operation === "courseRankings")
    output = await runtime.queryCourseRankings(
      input as CourseQueryOperations["courseRankings"]["input"],
    );
  else
    output = await runtime.queryCourseDetails(
      input as CourseQueryOperations["courseDetails"]["input"],
    );
  return output as CourseQueryOperations[Selected]["output"];
}

function cached<Selected extends Operation>(
  operation: Selected,
  input: CourseQueryOperations[Selected]["input"],
) {
  const cacheKey = key(operation, input);
  let entry = cache.get(cacheKey);
  if (!entry) {
    const created: Entry = { promise: execute(operation, input) };
    void created.promise.then(
      (value) => {
        created.value = value;
      },
      () => undefined,
    );
    cache.set(cacheKey, created);
    entry = created;
  }
  return entry as {
    promise: Promise<CourseQueryOperations[Selected]["output"]>;
    value?: CourseQueryOperations[Selected]["output"];
  };
}

export function queryCourseRankings(
  input: RankingsQuery & { entity: "course" },
) {
  return cached("courseRankings", input).promise;
}

export function cachedCourseRankings(
  input: RankingsQuery & { entity: "course" },
) {
  return cached("courseRankings", input).value;
}

export function queryCourseDetails(
  input: CourseQueryOperations["courseDetails"]["input"],
) {
  return cached("courseDetails", input).promise;
}

export function cachedCourseDetails(
  input: CourseQueryOperations["courseDetails"]["input"],
) {
  return cached("courseDetails", input).value;
}

export async function queryCourseRankingPages(
  query: RankingsQuery & { entity: "course" },
  pages: number,
): Promise<RankingsPage<"course">> {
  if (pages === 1) return queryCourseRankings(query);
  const expectedCursor = query.cursor;
  const discoverCursor = pages === 0;
  const first = await queryCourseRankings({ ...query, cursor: undefined });
  let combined = first;
  for (let page = 2; discoverCursor || page <= pages; page += 1) {
    const cursor = combined.nextCursor;
    if (!cursor) throw new Error("Ranking page expired.");
    if (
      expectedCursor &&
      ((discoverCursor && cursor === expectedCursor) ||
        (!discoverCursor && page === pages && cursor === expectedCursor))
    ) {
      const next = await queryCourseRankings({ ...query, cursor });
      return {
        ...combined,
        nextCursor: next.nextCursor,
        results: [...combined.results, ...next.results],
      };
    }
    if (!discoverCursor && page === pages)
      throw new Error("Ranking page expired.");
    const next = await queryCourseRankings({ ...query, cursor });
    combined = {
      ...combined,
      nextCursor: next.nextCursor,
      results: [...combined.results, ...next.results],
    };
  }
  return combined;
}

function rankingPreference() {
  const prefix = `${RANKING_PREFERENCE_COOKIE}=`;
  const value = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  return parseRankingPreference(value);
}

function searchParams(url: URL) {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of url.searchParams) {
    const current = result[name];
    result[name] = current
      ? Array.isArray(current)
        ? [...current, value]
        : [current, value]
      : value;
  }
  return result;
}

export async function preloadPublicQuery(href: string) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.pathname === "/rankings/courses") {
    const { courseRankingPages, courseRankingQuery } = await import(
      "@/app/rankings/course-query"
    );
    const params = searchParams(url);
    return queryCourseRankingPages(
      courseRankingQuery(params, rankingPreference()),
      courseRankingPages(params),
    );
  }
  const match = url.pathname.match(
    /^\/courses\/([^/]+)\/([^/]+)(?:\/([0-9]{4}))?(?:\/[^/]+)?$/,
  );
  if (!match) return;
  const [, prefix = "", number = "", pathTerm] = match;
  const preference = rankingPreferenceQuery(rankingPreference());
  return queryCourseDetails({
    coursePrefix: decodeURIComponent(prefix),
    courseNumber: decodeURIComponent(number),
    termCode: url.searchParams.get("term") ?? pathTerm,
    ...preference,
  });
}

export type { CourseRankings };
