import { afterEach, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationPointer, RankingFailure } from "@/lib/rankings/server";
import { makeRankingGeneration } from "./rankings-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function reidentifyGeneration(directory: string, sha: string) {
  const target = join(directory, "..", sha);
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.sourceCommit = sha;
  for (const identity of manifest.identities)
    for (const alias of identity.aliases) alias.sourceCommit = sha;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await rename(directory, target);
  return target;
}

afterEach(async () => {
  delete process.env.RANKINGS_SEED_DIR;
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

test("the upstream adapter pins all five LFS objects to one full commit", async () => {
  const sha = "2123456789abcdef0123456789abcdef01234567";
  const bytes = Buffer.from("PAR1fixturePAR1");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const filenames = [
    "course-instructors.parquet",
    "course-rankings.parquet",
    "course-ratings.parquet",
    "instructor-rankings.parquet",
    "instructor-ratings.parquet",
  ];
  const requests: string[] = [];
  const request = mock(async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/revision/"))
      return Response.json({
        sha,
        lastModified: "2026-08-20T06:00:00.000Z",
      });
    if (url.includes("/tree/"))
      return Response.json(
        filenames.map((path) => ({
          type: "file",
          path,
          size: bytes.length,
          lfs: { oid: digest, size: bytes.length },
        })),
      );
    return new Response(bytes);
  });
  const { HuggingFaceRankingSource } = await import("@/lib/rankings/runtime");
  const source = new HuggingFaceRankingSource(request);

  const candidate = await source.download(sha);
  temporaryDirectories.push(join(candidate.directory, ".."));

  expect(candidate.sha).toBe(sha);
  expect(Object.keys(candidate.artifacts)).toEqual(filenames);
  expect(
    requests.filter((url) => url.includes(`/resolve/${sha}/`)),
  ).toHaveLength(5);
});

test("the refresh operation rejects unauthenticated requests", async () => {
  process.env.RANKINGS_REFRESH_SECRET = "correct-secret-with-enough-entropy";
  try {
    const { POST } = await import("@/app/api/rankings/refresh/route");
    const response = await POST(
      new Request("https://example.test/api/rankings/refresh", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
        body: JSON.stringify({
          sha: "0123456789abcdef0123456789abcdef01234567",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  } finally {
    delete process.env.RANKINGS_REFRESH_SECRET;
  }
});

test("a complete refresh activates one immutable generation atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "ranking-refresh-"));
  temporaryDirectories.push(root);
  const sourceDirectory = await makeRankingGeneration(root);
  const sourceManifest = JSON.parse(
    await readFile(join(sourceDirectory, "manifest.json"), "utf8"),
  );
  await rm(join(sourceDirectory, "manifest.json"));
  const { queryRankings, refreshRankings } = await import(
    "@/lib/rankings/server"
  );

  const stored = new Map<string, string>();
  let pointer: GenerationPointer | undefined;
  const result = await refreshRankings(
    { sha: "0123456789abcdef0123456789abcdef01234567" },
    {
      upstream: {
        async download(sha: string) {
          return {
            sha,
            sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
            directory: sourceDirectory,
            artifacts: sourceManifest.artifacts,
          };
        },
      },
      store: {
        async readPointer() {
          return pointer;
        },
        async downloadGeneration(sha: string) {
          return stored.get(sha);
        },
        async putGeneration(sha: string, directory: string) {
          stored.set(sha, directory);
        },
        async writePointer(value: GenerationPointer) {
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
    },
  );

  expect(result).toMatchObject({
    status: "activated",
    generation: "0123456789abcdef0123456789abcdef01234567",
  });
  expect(pointer).toMatchObject({
    activeSha: "0123456789abcdef0123456789abcdef01234567",
  });
  expect(
    (await queryRankings({ entity: "instructor", termCode: "2510" }))
      .generation,
  ).toBe("0123456789abcdef0123456789abcdef01234567");
});

test("a failed refresh records a bounded class and keeps last-known-good active", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "ranking-refresh-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "ranking-refresh-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  const first = await makeRankingGeneration(firstRoot);
  const secondSha = "1123456789abcdef0123456789abcdef01234567";
  const second = await reidentifyGeneration(
    await makeRankingGeneration(secondRoot),
    secondSha,
  );
  const corrupted = join(second, "instructor-rankings.parquet");
  const bytes = await readFile(corrupted);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(corrupted, bytes);

  const { getRankingsHealth, queryRankings, refreshRankings } = await import(
    "@/lib/rankings/server"
  );
  let pointer: GenerationPointer | undefined;
  let failure: RankingFailure | undefined;
  let source = {
    sha: "0123456789abcdef0123456789abcdef01234567",
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
    directory: first,
  };
  let attempts = 0;
  const dependencies = {
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
      async writePointer(value: GenerationPointer) {
        pointer = structuredClone(value);
      },
      async readFailure() {
        return failure;
      },
      async writeFailure(value: RankingFailure | undefined) {
        failure = structuredClone(value);
      },
    },
    async withLock<T>(operation: () => Promise<T>) {
      return operation();
    },
    async sleep() {},
  };
  await refreshRankings({}, dependencies);
  source = {
    sha: secondSha,
    sourceUpdatedAt: "2026-08-20T07:00:00.000Z",
    directory: second,
  };

  await expect(refreshRankings({}, dependencies)).rejects.toThrow(
    "Rankings refresh failed",
  );
  expect(attempts).toBe(4);
  expect(failure).toMatchObject({ class: "integrity" });
  expect(pointer).toMatchObject({
    activeSha: "0123456789abcdef0123456789abcdef01234567",
  });
  expect(
    (await queryRankings({ entity: "instructor", termCode: "2510" }))
      .generation,
  ).toBe("0123456789abcdef0123456789abcdef01234567");
  expect(await getRankingsHealth(dependencies)).toMatchObject({
    status: "stale",
    activeGeneration: "0123456789abcdef0123456789abcdef01234567",
    failureClass: "integrity",
  });
});
