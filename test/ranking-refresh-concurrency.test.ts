import { afterEach, expect, mock, test } from "bun:test";
import {
  access,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
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

async function generationWithSha(
  root: string,
  sha: string,
  options: { extraInstructors?: number } = {},
) {
  const original = await makeRankingGeneration(root, undefined, options);
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

test("refresh extends the current stored Instructor registry across instances", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "ranking-registry-first-"));
  const currentRoot = await mkdtemp(
    join(tmpdir(), "ranking-registry-current-"),
  );
  const candidateRoot = await mkdtemp(
    join(tmpdir(), "ranking-registry-candidate-"),
  );
  temporaryDirectories.push(firstRoot, currentRoot, candidateRoot);
  const firstSha = "6123456789abcdef0123456789abcdef01234567";
  const currentSha = "7123456789abcdef0123456789abcdef01234567";
  const candidateSha = "8123456789abcdef0123456789abcdef01234567";
  const first = await generationWithSha(firstRoot, firstSha);
  const current = await generationWithSha(currentRoot, currentSha);
  const candidate = await generationWithSha(candidateRoot, candidateSha);
  const currentManifestPath = join(current, "manifest.json");
  const currentManifest = JSON.parse(
    await readFile(currentManifestPath, "utf8"),
  );
  currentManifest.identities[0].uuid = "90000000-0000-4000-8000-000000000001";
  await writeFile(currentManifestPath, JSON.stringify(currentManifest));
  const candidateManifestPath = join(candidate, "manifest.json");
  const candidateManifest = JSON.parse(
    await readFile(candidateManifestPath, "utf8"),
  );
  await rm(candidateManifestPath);

  let pointer: GenerationPointer | undefined;
  const stored = new Map([
    [firstSha, first],
    [currentSha, current],
  ]);
  let source: Awaited<
    ReturnType<RankingRefreshDependencies["upstream"]["download"]>
  > = {
    sha: firstSha,
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
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
      async downloadGeneration(sha) {
        return stored.get(sha);
      },
      async putGeneration(sha, directory) {
        stored.set(sha, directory);
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
  const { queryRankings, refreshRankings } = await import(
    "@/lib/rankings/server"
  );
  await refreshRankings({}, dependencies);
  pointer = {
    activeSha: currentSha,
    previousSha: firstSha,
    acceptedAt: "2026-08-20T07:00:00.000Z",
    sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
  };
  source = {
    sha: candidateSha,
    sourceUpdatedAt: "2026-08-20T08:00:00.000Z",
    directory: candidate,
    artifacts: candidateManifest.artifacts,
  };

  await refreshRankings({}, dependencies);
  const page = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    search: "Alpha Instructor",
  });

  expect(page.results[0]?.uuid).toBe("90000000-0000-4000-8000-000000000001");
});

test("getRankings retains one generation snapshot across activation", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "ranking-details-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "ranking-details-second-"));
  const thirdRoot = await mkdtemp(join(tmpdir(), "ranking-details-third-"));
  temporaryDirectories.push(firstRoot, secondRoot, thirdRoot);
  const firstSha = "e123456789abcdef0123456789abcdef01234567";
  const secondSha = "f123456789abcdef0123456789abcdef01234567";
  const thirdSha = "9123456789abcdef0123456789abcdef01234567";
  const first = await generationWithSha(firstRoot, firstSha);
  const second = await generationWithSha(secondRoot, secondSha, {
    extraInstructors: 10,
  });
  const third = await generationWithSha(thirdRoot, thirdSha, {
    extraInstructors: 20,
  });
  let pointer: GenerationPointer | undefined;
  const stored = new Map<string, string>();
  let source = {
    sha: firstSha,
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
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
      async downloadGeneration(sha) {
        return stored.get(sha);
      },
      async putGeneration(sha, directory) {
        stored.set(sha, directory);
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
  const {
    getRankings,
    getRankingsRuntimeStatsForTests,
    refreshRankings,
    setRankingsAfterAcquireForTests,
  } = await import("@/lib/rankings/server");
  await refreshRankings({}, dependencies);
  source = {
    sha: secondSha,
    sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
    directory: second,
  };
  let resume: (() => void) | undefined;
  let acquired: (() => void) | undefined;
  const acquiredGeneration = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const activation = new Promise<void>((resolve) => {
    resume = resolve;
  });
  setRankingsAfterAcquireForTests(async (sha) => {
    if (sha === firstSha) {
      acquired?.();
      await activation;
    }
  });

  const detailsPromise = getRankings({
    type: "instructor",
    uuid: "00000000-0000-4000-8000-000000000001",
  });
  await acquiredGeneration;
  await refreshRankings({}, dependencies);
  source = {
    sha: thirdSha,
    sourceUpdatedAt: "2026-08-20T08:00:00.000Z",
    directory: third,
  };
  await refreshRankings({}, dependencies);
  expect(getRankingsRuntimeStatsForTests().openGenerations).toBe(3);
  resume?.();
  const details = await detailsPromise;

  expect(details.generation).toBe(firstSha);
  expect(details.population.size).toBe(3);
  expect(getRankingsRuntimeStatsForTests().openGenerations).toBe(2);
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

test("repeated refreshes retain only active and previous native snapshots", async () => {
  const shas = [
    "a123456789abcdef0123456789abcdef01234567",
    "b123456789abcdef0123456789abcdef01234567",
    "c123456789abcdef0123456789abcdef01234567",
    "d123456789abcdef0123456789abcdef01234567",
  ];
  const directories: string[] = [];
  for (const [index, sha] of shas.entries()) {
    const root = await mkdtemp(join(tmpdir(), `ranking-retention-${index}-`));
    temporaryDirectories.push(root);
    directories.push(await generationWithSha(root, sha));
  }
  let index = 0;
  let pointer: GenerationPointer | undefined;
  const stored = new Map<string, string>();
  const dependencies: RankingRefreshDependencies = {
    upstream: {
      async download() {
        return {
          sha: shas[index],
          sourceUpdatedAt: `2026-08-2${index}T06:00:00.000Z`,
          directory: directories[index++],
          temporary: true,
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
      async putGeneration(sha, directory) {
        stored.set(sha, directory);
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
  const { getRankingsRuntimeStatsForTests, refreshRankings } = await import(
    "@/lib/rankings/server"
  );

  for (const sha of shas) {
    await expect(refreshRankings({ sha }, dependencies)).resolves.toMatchObject(
      {
        status: "activated",
        generation: sha,
      },
    );
  }

  expect(getRankingsRuntimeStatsForTests().openGenerations).toBeLessThanOrEqual(
    3,
  );
  await expect(access(join(directories[0], "manifest.json"))).rejects.toThrow();
  expect(pointer).toMatchObject({
    activeSha: shas[3],
    previousSha: shas[2],
  });
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
