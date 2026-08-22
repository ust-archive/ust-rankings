import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type {
  ScheduleGenerationPointer,
  ScheduleRefreshDependencies,
} from "@/lib/schedule/server";
import {
  installRankingGeneration,
  makeRankingGeneration,
} from "./rankings-fixture";
import { makeScheduleGeneration, scheduleFixtureSha } from "./schedule-fixture";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const [{ resetRankingsRuntimeForTests }, { resetScheduleRuntimeForTests }] =
    await Promise.all([
      import("@/lib/rankings/server"),
      import("@/lib/schedule/server"),
    ]);
  await Promise.all([
    resetRankingsRuntimeForTests(),
    resetScheduleRuntimeForTests(),
  ]);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("the Schedule source pins both files to one immutable commit", async () => {
  const sha = "3234567890abcdef1234567890abcdef12345678";
  const bytes = Buffer.from("PAR1fixturePAR1");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const requests: string[] = [];
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/revision/"))
      return Response.json({
        sha,
        lastModified: "2026-08-20T06:00:00.000Z",
      });
    if (url.includes("/tree/"))
      return Response.json(
        ["classes.parquet", "courses.parquet"].map((path) => ({
          type: "file",
          path,
          size: bytes.length,
          lfs: { oid: digest, size: bytes.length },
        })),
      );
    return new Response(bytes);
  });
  const { HuggingFaceScheduleSource } = await import("@/lib/schedule/runtime");
  const candidate = await new HuggingFaceScheduleSource(request).download(sha);
  temporaryDirectories.push(join(candidate.directory, ".."));

  expect(candidate.sha).toBe(sha);
  expect(Object.keys(candidate.artifacts)).toEqual([
    "classes.parquet",
    "courses.parquet",
  ]);
  expect(
    requests.filter((url) => url.includes(`/resolve/${sha}/`)),
  ).toHaveLength(2);
});

test("a complete Schedule refresh validates both files before atomic activation", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-refresh-"));
  temporaryDirectories.push(root);
  const directory = await makeScheduleGeneration(root);
  let pointer: ScheduleGenerationPointer | undefined;
  const stored = new Map<string, string>();
  const dependencies: ScheduleRefreshDependencies = {
    upstream: {
      async download() {
        return {
          sha: scheduleFixtureSha,
          sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
          directory,
        };
      },
    },
    store: {
      async readPointer() {
        return pointer;
      },
      async downloadGeneration(sha) {
        return stored.get(sha);
      },
      async putGeneration(sha, generationDirectory) {
        stored.set(sha, generationDirectory);
      },
      async writePointer(value) {
        pointer = structuredClone(value);
      },
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  const { querySchedule, refreshSchedule } = await import(
    "@/lib/schedule/server"
  );

  const result = await refreshSchedule({}, dependencies);
  const page = await querySchedule({ termCode: "2510" });

  expect(result).toEqual({
    status: "activated",
    generation: scheduleFixtureSha,
  });
  expect(pointer).toMatchObject({ activeSha: scheduleFixtureSha });
  expect(page.generation).toBe(scheduleFixtureSha);
});

test("refresh creates a private manifest from the two declared source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-source-generation-"));
  temporaryDirectories.push(root);
  const directory = await makeScheduleGeneration(root);
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await rm(manifestPath);
  let pointer: ScheduleGenerationPointer | undefined;
  const dependencies: ScheduleRefreshDependencies = {
    upstream: {
      async download() {
        return {
          sha: scheduleFixtureSha,
          sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
          directory,
          artifacts: manifest.artifacts,
        };
      },
    },
    store: {
      async readPointer() {
        return pointer;
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {
        await stat(manifestPath);
      },
      async writePointer(value) {
        pointer = structuredClone(value);
      },
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  const { refreshSchedule } = await import("@/lib/schedule/server");

  await expect(refreshSchedule({}, dependencies)).resolves.toMatchObject({
    status: "activated",
    generation: scheduleFixtureSha,
  });
  expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
    sourceCommit: scheduleFixtureSha,
    artifacts: manifest.artifacts,
  });
});

test("a rejected temporary Schedule candidate is cleaned after bounded retries", async () => {
  const roots: string[] = [];
  const dependencies = {
    upstream: {
      async download() {
        const root = await mkdtemp(join(tmpdir(), "schedule-rejected-"));
        roots.push(root);
        const directory = await makeScheduleGeneration(root);
        const bytes = await readFile(join(directory, "classes.parquet"));
        bytes[Math.floor(bytes.length / 2)] ^= 1;
        await writeFile(join(directory, "classes.parquet"), bytes);
        return {
          sha: scheduleFixtureSha,
          sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
          directory,
          temporary: true,
        };
      },
    },
    store: {
      async readPointer() {
        return undefined;
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {},
      async writePointer() {},
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  } as ScheduleRefreshDependencies;
  const { refreshSchedule } = await import("@/lib/schedule/server");

  await expect(refreshSchedule({}, dependencies)).rejects.toThrow(
    "Schedule refresh failed",
  );
  expect(roots).toHaveLength(3);
  for (const root of roots) await expect(access(root)).rejects.toThrow();
});

test("startup rejects a damaged active Schedule generation and serves retained last-known-good", async () => {
  const activeRoot = await mkdtemp(join(tmpdir(), "schedule-active-bad-"));
  const previousRoot = await mkdtemp(join(tmpdir(), "schedule-previous-good-"));
  temporaryDirectories.push(activeRoot, previousRoot);
  const activeSha = "4234567890abcdef1234567890abcdef12345678";
  const previousSha = "5234567890abcdef1234567890abcdef12345678";
  const active = await makeScheduleGeneration(activeRoot, undefined, activeSha);
  const previous = await makeScheduleGeneration(
    previousRoot,
    undefined,
    previousSha,
  );
  const bytes = await readFile(join(active, "courses.parquet"));
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(join(active, "courses.parquet"), bytes);
  const dependencies: ScheduleRefreshDependencies = {
    upstream: {
      async download() {
        throw new Error("not used");
      },
    },
    store: {
      async readPointer() {
        return {
          activeSha,
          previousSha,
          acceptedAt: "2026-08-20T07:00:00.000Z",
          sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
        };
      },
      async downloadGeneration(sha) {
        return sha === activeSha ? active : previous;
      },
      async putGeneration() {},
      async writePointer() {},
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  const { querySchedule, resetScheduleRuntimeForTests } = await import(
    "@/lib/schedule/server"
  );
  await resetScheduleRuntimeForTests(dependencies);

  const page = await querySchedule({ termCode: "2510" });

  expect(page.generation).toBe(previousSha);
});

test("a concurrent Schedule reader retains one complete generation across activation", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "schedule-reader-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "schedule-reader-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  const secondSha = "6234567890abcdef1234567890abcdef12345678";
  const first = await makeScheduleGeneration(firstRoot);
  const second = await makeScheduleGeneration(secondRoot, undefined, secondSha);
  let source = {
    sha: scheduleFixtureSha,
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
  let pointer: ScheduleGenerationPointer | undefined;
  const dependencies: ScheduleRefreshDependencies = {
    upstream: {
      async download() {
        return source;
      },
    },
    store: {
      async readPointer() {
        return pointer;
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {},
      async writePointer(value) {
        pointer = structuredClone(value);
      },
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  const { querySchedule, refreshSchedule, setScheduleAfterAcquireForTests } =
    await import("@/lib/schedule/server");
  await refreshSchedule({}, dependencies);
  let acquired: (() => void) | undefined;
  let resume: (() => void) | undefined;
  const readerAcquired = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const activation = new Promise<void>((resolve) => {
    resume = resolve;
  });
  setScheduleAfterAcquireForTests(async (sha) => {
    if (sha === scheduleFixtureSha) {
      acquired?.();
      await activation;
    }
  });

  const reading = querySchedule({ termCode: "2510" });
  await readerAcquired;
  source = {
    sha: secondSha,
    sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
    directory: second,
  };
  await refreshSchedule({}, dependencies);
  resume?.();

  expect((await reading).generation).toBe(scheduleFixtureSha);
  expect((await querySchedule({ termCode: "2510" })).generation).toBe(
    secondSha,
  );
});

test("concurrent Schedule refresh invocation reports busy without downloading", async () => {
  let downloaded = false;
  const dependencies = {
    upstream: {
      async download() {
        downloaded = true;
        throw new Error("unused");
      },
    },
    store: {
      async readPointer() {
        return undefined;
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {},
      async writePointer() {},
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock() {
      return undefined;
    },
    async sleep() {},
  } as ScheduleRefreshDependencies;
  const { refreshSchedule } = await import("@/lib/schedule/server");

  await expect(refreshSchedule({}, dependencies)).resolves.toEqual({
    status: "busy",
  });
  expect(downloaded).toBe(false);
});

test("a validated current Schedule generation clears a retained failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-current-recovery-"));
  temporaryDirectories.push(root);
  const directory = await makeScheduleGeneration(root);
  const now = new Date().toISOString();
  const pointer: ScheduleGenerationPointer = {
    activeSha: scheduleFixtureSha,
    acceptedAt: now,
    sourceUpdatedAt: now,
  };
  let failure: Awaited<
    ReturnType<ScheduleRefreshDependencies["store"]["readFailure"]>
  > = { class: "integrity", at: now };
  let downloads = 0;
  const dependencies: ScheduleRefreshDependencies = {
    upstream: {
      async download() {
        downloads += 1;
        return {
          sha: scheduleFixtureSha,
          sourceUpdatedAt: now,
          directory,
        };
      },
    },
    store: {
      async readPointer() {
        return pointer;
      },
      async downloadGeneration() {
        return directory;
      },
      async putGeneration() {},
      async writePointer() {},
      async readFailure() {
        return failure;
      },
      async writeFailure(value) {
        failure = value;
      },
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  const { getScheduleHealth, refreshSchedule } = await import(
    "@/lib/schedule/server"
  );

  await expect(
    refreshSchedule({ sha: scheduleFixtureSha }, dependencies),
  ).resolves.toEqual({ status: "current", generation: scheduleFixtureSha });
  expect(downloads).toBe(1);
  expect(failure).toBeUndefined();
  expect(await getScheduleHealth(dependencies)).toMatchObject({
    status: "healthy",
    activeGeneration: scheduleFixtureSha,
    failureClass: undefined,
  });
});

test("Schedule pointer storage errors are not mislabeled as lock failures", async () => {
  let failure: Awaited<
    ReturnType<ScheduleRefreshDependencies["store"]["readFailure"]>
  >;
  const dependencies = {
    upstream: {
      async download() {
        throw new Error("not used");
      },
    },
    store: {
      async readPointer() {
        throw new Error("Space unavailable");
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {},
      async writePointer() {},
      async readFailure() {
        return failure;
      },
      async writeFailure(value: typeof failure) {
        failure = value;
      },
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  } as ScheduleRefreshDependencies;
  const { refreshSchedule } = await import("@/lib/schedule/server");

  await expect(refreshSchedule({}, dependencies)).rejects.toMatchObject({
    name: "ScheduleRefreshError",
    failureClass: "storage",
  });
  expect(failure).toMatchObject({ class: "storage" });
});

test("a failed Schedule refresh keeps last-known-good active and reports stale health", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "schedule-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "schedule-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  const secondSha = "2234567890abcdef1234567890abcdef12345678";
  const first = await makeScheduleGeneration(firstRoot);
  const second = await makeScheduleGeneration(secondRoot, undefined, secondSha);
  const corrupted = join(second, "classes.parquet");
  const bytes = await readFile(corrupted);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(corrupted, bytes);
  let source = {
    sha: scheduleFixtureSha,
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
  let attempts = 0;
  let pointer: ScheduleGenerationPointer | undefined;
  let failure: Awaited<
    ReturnType<ScheduleRefreshDependencies["store"]["readFailure"]>
  >;
  const dependencies: ScheduleRefreshDependencies = {
    upstream: {
      async download() {
        attempts += 1;
        return source;
      },
    },
    store: {
      async readPointer() {
        return pointer;
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {},
      async writePointer(value) {
        pointer = structuredClone(value);
      },
      async readFailure() {
        return failure;
      },
      async writeFailure(value) {
        failure = structuredClone(value);
      },
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  const { getScheduleHealth, querySchedule, refreshSchedule } = await import(
    "@/lib/schedule/server"
  );
  await refreshSchedule({}, dependencies);
  source = {
    sha: secondSha,
    sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
    directory: second,
  };

  await expect(refreshSchedule({}, dependencies)).rejects.toThrow(
    "Schedule refresh failed",
  );

  expect(attempts).toBe(4);
  expect(pointer).toMatchObject({ activeSha: scheduleFixtureSha });
  expect((await querySchedule({ termCode: "2510" })).generation).toBe(
    scheduleFixtureSha,
  );
  expect(await getScheduleHealth(dependencies)).toMatchObject({
    status: "stale",
    activeGeneration: scheduleFixtureSha,
    failureClass: "integrity",
  });
  const rankingsRoot = await mkdtemp(join(tmpdir(), "rankings-boundary-"));
  temporaryDirectories.push(rankingsRoot);
  await installRankingGeneration(await makeRankingGeneration(rankingsRoot));
  const { queryRankings } = await import("@/lib/rankings/server");
  expect(
    (await queryRankings({ entity: "instructor", limit: 1 })).results,
  ).toHaveLength(1);
});
