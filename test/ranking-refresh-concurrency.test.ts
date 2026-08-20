import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GenerationPointer,
  RankingFailure,
  RankingRefreshDependencies,
} from "@/lib/rankings/server";
import { makeRankingGeneration } from "./rankings-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function generationWithSha(root: string, sha: string) {
  const original = await makeRankingGeneration(root);
  const target = join(root, sha);
  const manifest = JSON.parse(
    await readFile(join(original, "manifest.json"), "utf8"),
  );
  manifest.sourceCommit = sha;
  for (const identity of manifest.identities)
    for (const alias of identity.aliases) alias.sourceCommit = sha;
  await writeFile(join(original, "manifest.json"), JSON.stringify(manifest));
  await rename(original, target);
  return target;
}

afterEach(async () => {
  const { resetRankingsRuntimeForTests } = await import(
    "@/lib/rankings/server"
  );
  await resetRankingsRuntimeForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("concurrent readers observe either complete generation around atomic activation", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "ranking-atomic-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "ranking-atomic-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  const firstSha = "0123456789abcdef0123456789abcdef01234567";
  const secondSha = "3123456789abcdef0123456789abcdef01234567";
  const first = await generationWithSha(firstRoot, firstSha);
  const second = await generationWithSha(secondRoot, secondSha);
  let source = {
    sha: firstSha,
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
  let pointer: GenerationPointer | undefined;
  let failure: RankingFailure | undefined;
  let releaseUpload: (() => void) | undefined;
  let uploadStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    uploadStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const dependencies: RankingRefreshDependencies = {
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
      async putGeneration(sha) {
        if (sha === secondSha) {
          uploadStarted?.();
          await blocked;
        }
      },
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
  const { queryRankings, refreshRankings } = await import(
    "@/lib/rankings/server"
  );
  await refreshRankings({}, dependencies);
  source = {
    sha: secondSha,
    sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
    directory: second,
  };

  const refreshing = refreshRankings({}, dependencies);
  await started;
  const during = await queryRankings({
    entity: "instructor",
    termCode: "2510",
  });
  releaseUpload?.();
  await refreshing;
  const after = await queryRankings({
    entity: "instructor",
    termCode: "2510",
  });

  expect(during.generation).toBe(firstSha);
  expect(after.generation).toBe(secondSha);
  expect(pointer).toMatchObject({
    activeSha: secondSha,
    previousSha: firstSha,
  });

  source = {
    sha: firstSha,
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
  await expect(
    refreshRankings({ sha: firstSha }, dependencies),
  ).resolves.toEqual({ status: "superseded", generation: secondSha });
  expect(pointer).toMatchObject({ activeSha: secondSha });
});

test("startup rejects a damaged active generation and serves retained last-known-good", async () => {
  const activeRoot = await mkdtemp(join(tmpdir(), "ranking-active-bad-"));
  const previousRoot = await mkdtemp(join(tmpdir(), "ranking-previous-good-"));
  temporaryDirectories.push(activeRoot, previousRoot);
  const activeSha = "4123456789abcdef0123456789abcdef01234567";
  const previousSha = "5123456789abcdef0123456789abcdef01234567";
  const active = await generationWithSha(activeRoot, activeSha);
  const previous = await generationWithSha(previousRoot, previousSha);
  const bytes = await readFile(join(active, "course-ratings.parquet"));
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(join(active, "course-ratings.parquet"), bytes);
  const dependencies: RankingRefreshDependencies = {
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
  const { queryRankings, resetRankingsRuntimeForTests } = await import(
    "@/lib/rankings/server"
  );
  await resetRankingsRuntimeForTests(dependencies);

  const page = await queryRankings({ entity: "instructor", termCode: "2510" });

  expect(page.generation).toBe(previousSha);
});

test("the distributed exclusion reports busy without starting another refresh", async () => {
  let downloaded = false;
  const dependencies = {
    upstream: {
      async download() {
        downloaded = true;
        throw new Error("must not run");
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
  } as RankingRefreshDependencies;
  const { refreshRankings } = await import("@/lib/rankings/server");

  await expect(refreshRankings({}, dependencies)).resolves.toEqual({
    status: "busy",
  });
  expect(downloaded).toBeFalse();
});
