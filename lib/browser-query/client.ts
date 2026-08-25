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
import { rankingSearchParams } from "@/lib/rankings/url";
import { DELIVERY_CDN_BASE_URL } from "@/lib/server-index-contract";
import type {
  CourseQueryOperations,
  QueryRequest,
  QueryResponse,
} from "./protocol";

type Operation = keyof CourseQueryOperations;
type Entry = { promise: Promise<unknown>; value?: unknown };
type Pending = {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};
const cache = new Map<string, Entry>();
const pending = new Map<number, Pending>();
let requestId = 0;
let queryWorker: Worker | undefined;
let workerFailure: Error | undefined;

export class BrowserQueryError extends Error {
  constructor(
    readonly code: "invalid" | "stale" | "unavailable" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

function key(operation: Operation, input: unknown) {
  return `${operation}:${JSON.stringify(input)}`;
}

function failWorker(error: Error) {
  workerFailure ??= error;
  queryWorker?.terminate();
  queryWorker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function worker() {
  if (workerFailure) throw workerFailure;
  if (queryWorker) return queryWorker;
  queryWorker = new Worker(new URL("./worker.ts", import.meta.url), {
    name: "public-course-query",
    type: "module",
  });
  queryWorker.addEventListener("error", () => {
    failWorker(
      new BrowserQueryError(
        "unavailable",
        "Public Course data is unavailable.",
      ),
    );
  });
  queryWorker.addEventListener(
    "message",
    (event: MessageEvent<QueryResponse>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(event.data.id);
      if (event.data.ok) request.resolve(event.data.output);
      else {
        const error = new BrowserQueryError(
          event.data.error.code,
          event.data.error.message,
        );
        request.reject(error);
      }
    },
  );
  return queryWorker;
}

function execute<Selected extends Operation>(
  operation: Selected,
  input: CourseQueryOperations[Selected]["input"],
): Promise<CourseQueryOperations[Selected]["output"]> {
  const id = ++requestId;
  const request = {
    id,
    baseUrl: (
      process.env.NEXT_PUBLIC_DELIVERY_BASE_URL ?? DELIVERY_CDN_BASE_URL
    ).replace(/\/+$/, ""),
    operation,
    input,
  } as QueryRequest<Selected>;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new BrowserQueryError(
        "unavailable",
        "Public Course query timed out.",
      );
      failWorker(error);
    }, 30_000);
    pending.set(id, { reject, resolve, timer });
    try {
      worker().postMessage(request);
    } catch (error) {
      failWorker(
        error instanceof Error
          ? error
          : new BrowserQueryError(
              "unavailable",
              "Public Course data is unavailable.",
            ),
      );
    }
  }) as Promise<CourseQueryOperations[Selected]["output"]>;
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
      () => {
        if (cache.get(cacheKey) === created) cache.delete(cacheKey);
      },
    );
    cache.set(cacheKey, created);
    if (cache.size > 128) cache.delete(cache.keys().next().value as string);
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

export function queryInstructorRankings(
  input: RankingsQuery & { entity: "instructor" },
) {
  return cached("instructorRankings", input).promise;
}

export function cachedInstructorRankings(
  input: RankingsQuery & { entity: "instructor" },
) {
  return cached("instructorRankings", input).value;
}

export function queryInstructorDetails(
  input: CourseQueryOperations["instructorDetails"]["input"],
) {
  return cached("instructorDetails", input).promise;
}

export function cachedInstructorDetails(
  input: CourseQueryOperations["instructorDetails"]["input"],
) {
  return cached("instructorDetails", input).value;
}

export function querySchedulePage(
  input: CourseQueryOperations["schedulePage"]["input"],
) {
  return cached("schedulePage", input).promise;
}

export function queryScheduleDetails(
  input: CourseQueryOperations["scheduleDetails"]["input"],
) {
  return cached("scheduleDetails", input).promise;
}

export function cachedScheduleDetails(
  input: CourseQueryOperations["scheduleDetails"]["input"],
) {
  return cached("scheduleDetails", input).value;
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

export async function queryInstructorRankingPages(
  query: RankingsQuery & { entity: "instructor" },
  pages: number,
): Promise<RankingsPage<"instructor">> {
  if (pages === 1) return queryInstructorRankings(query);
  const expectedCursor = query.cursor;
  const discoverCursor = pages === 0;
  const first = await queryInstructorRankings({ ...query, cursor: undefined });
  let combined = first;
  for (let page = 2; discoverCursor || page <= pages; page += 1) {
    const cursor = combined.nextCursor;
    if (!cursor) throw new Error("Ranking page expired.");
    if (
      expectedCursor &&
      ((discoverCursor && cursor === expectedCursor) ||
        (!discoverCursor && page === pages && cursor === expectedCursor))
    ) {
      const next = await queryInstructorRankings({ ...query, cursor });
      return {
        ...combined,
        nextCursor: next.nextCursor,
        results: [...combined.results, ...next.results],
      };
    }
    if (!discoverCursor && page === pages)
      throw new Error("Ranking page expired.");
    const next = await queryInstructorRankings({ ...query, cursor });
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

export async function preloadPublicQuery(href: string) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return href;
  if (url.pathname === "/rankings/instructors") {
    const { instructorRankingPages, instructorRankingQuery } = await import(
      "@/app/rankings/instructor-query"
    );
    const params = rankingSearchParams(url.searchParams);
    await queryInstructorRankingPages(
      instructorRankingQuery(params, rankingPreference()),
      instructorRankingPages(params),
    );
    return href;
  }
  if (url.pathname === "/rankings/courses") {
    const { courseRankingPages, courseRankingQuery } = await import(
      "@/app/rankings/course-query"
    );
    const params = rankingSearchParams(url.searchParams);
    await queryCourseRankingPages(
      courseRankingQuery(params, rankingPreference()),
      courseRankingPages(params),
    );
    return href;
  }
  const instructor = url.pathname.match(/^\/instructors\/([^/]+)$/);
  if (instructor?.[1]) {
    const details = await queryInstructorDetails({
      key: decodeURIComponent(instructor[1]),
      termCode: url.searchParams.get("term") ?? undefined,
      ...rankingPreferenceQuery(rankingPreference()),
    });
    await queryScheduleDetails({
      type: "instructor",
      uuids: details.familyUuids,
    });
    url.searchParams.set("_generation", details.generation);
    url.searchParams.set("_instructor", details.instructor.uuid);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  const match = url.pathname.match(
    /^\/courses\/([^/]+)\/([^/]+)(?:\/([0-9]{4}))?(?:\/[^/]+)?$/,
  );
  if (!match) return href;
  const [, prefix = "", number = "", pathTerm] = match;
  const preference = rankingPreferenceQuery(rankingPreference());
  const coursePrefix = decodeURIComponent(prefix);
  const courseNumber = decodeURIComponent(number);
  const termCode = url.searchParams.get("term") ?? pathTerm;
  const section = url.pathname.split("/")[5];
  const schedule = section
    ? queryScheduleDetails({
        type: "class",
        coursePrefix,
        courseNumber,
        termCode: termCode as string,
        section: decodeURIComponent(section),
      })
    : termCode
      ? queryScheduleDetails({
          type: "course-offering",
          coursePrefix,
          courseNumber,
          termCode,
        })
      : queryScheduleDetails({ type: "course", coursePrefix, courseNumber });
  await Promise.all([
    queryCourseDetails({
      coursePrefix,
      courseNumber,
      termCode,
      ...preference,
    }),
    schedule,
  ]);
  return href;
}

export type { CourseRankings };
