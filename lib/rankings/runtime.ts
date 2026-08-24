import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";
import type { RankingRefreshDependencies } from "./server";

const ARTIFACTS = [
  "course-instructors.parquet",
  "course-rankings.parquet",
  "course-ratings.parquet",
  "courses.parquet",
  "instructor-aliases.parquet",
  "instructor-identities.parquet",
  "instructor-identity-events.parquet",
  "instructor-rankings.parquet",
  "instructor-ratings.parquet",
  "instructor-split-affected-associations.parquet",
] as const;
const FULL_SHA = /^[0-9a-f]{40}$/;
const LFS_SHA = /^[0-9a-f]{64}$/;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_GENERATION_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

type TreeFile = {
  type?: unknown;
  path?: unknown;
  size?: unknown;
  lfs?: { oid?: unknown; size?: unknown };
};

function optionalEnvironment(name: string) {
  return process.env[name]?.trim() || undefined;
}

async function responseJson(response: Response) {
  if (!response.ok)
    throw new Error(`Upstream request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

class RankingSourceIntegrityError extends Error {
  readonly failureClass = "integrity" as const;
}

class ByteLimit extends Transform {
  bytes = 0;

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) {
      callback(
        new RankingSourceIntegrityError(
          "Ranking object exceeds its declared size",
        ),
      );
      return;
    }
    callback(null, chunk);
  }
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class HuggingFaceRankingSource {
  constructor(private readonly request: Fetch = fetch) {}

  async download(requestedSha?: string) {
    if (requestedSha !== undefined && !FULL_SHA.test(requestedSha))
      throw new Error("A full immutable commit SHA is required");
    const revision = requestedSha ?? "main";
    const metadata = (await responseJson(
      await this.request(
        `https://huggingface.co/api/datasets/ust-archive/ust-rankings/revision/${revision}`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) },
      ),
    )) as { sha?: unknown; lastModified?: unknown };
    if (
      typeof metadata.sha !== "string" ||
      !FULL_SHA.test(metadata.sha) ||
      (requestedSha !== undefined && metadata.sha !== requestedSha) ||
      typeof metadata.lastModified !== "string" ||
      !Number.isFinite(Date.parse(metadata.lastModified))
    ) {
      throw new RankingSourceIntegrityError(
        "Upstream revision metadata is not immutable",
      );
    }
    const sha = metadata.sha;
    const tree = await responseJson(
      await this.request(
        `https://huggingface.co/api/datasets/ust-archive/ust-rankings/tree/${sha}?recursive=true&expand=true`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) },
      ),
    );
    if (!Array.isArray(tree))
      throw new RankingSourceIntegrityError("Invalid upstream tree response");
    const parquet = (tree as TreeFile[]).filter(
      (entry) =>
        typeof entry.path === "string" &&
        !entry.path.includes("/") &&
        entry.path.endsWith(".parquet"),
    );
    if (
      JSON.stringify(parquet.map((entry) => entry.path).sort()) !==
      JSON.stringify(ARTIFACTS)
    ) {
      throw new RankingSourceIntegrityError(
        "Upstream tree is not a complete ranking generation",
      );
    }
    const artifacts: Record<string, { sha256: string; size: number }> = {};
    let totalSize = 0;
    for (const entry of parquet) {
      if (
        entry.type !== "file" ||
        typeof entry.path !== "string" ||
        typeof entry.size !== "number" ||
        typeof entry.lfs?.size !== "number" ||
        entry.size !== entry.lfs.size ||
        entry.size <= 0 ||
        entry.size > MAX_ARTIFACT_BYTES ||
        typeof entry.lfs.oid !== "string" ||
        !LFS_SHA.test(entry.lfs.oid)
      ) {
        throw new RankingSourceIntegrityError(
          "Invalid upstream LFS declaration",
        );
      }
      totalSize += entry.size;
      artifacts[entry.path] = { sha256: entry.lfs.oid, size: entry.size };
    }
    if (totalSize > MAX_GENERATION_BYTES)
      throw new RankingSourceIntegrityError(
        "Ranking generation exceeds the local resource bound",
      );

    const stagingRoot = await mkdtemp(join(tmpdir(), `rankings-${sha}-`));
    const directory = join(stagingRoot, sha);
    await mkdir(directory);
    try {
      await Promise.all(
        ARTIFACTS.map(async (filename) => {
          const response = await this.request(
            `https://huggingface.co/datasets/ust-archive/ust-rankings/resolve/${sha}/${filename}`,
            { cache: "no-store", signal: AbortSignal.timeout(60_000) },
          );
          if (!response.ok || !response.body)
            throw new Error(`Failed to download ${filename}`);
          const path = join(/* turbopackIgnore: true */ directory, filename);
          const declaration = artifacts[filename];
          const limit = new ByteLimit(declaration.size);
          await pipeline(
            Readable.fromWeb(response.body as never),
            limit,
            createWriteStream(path, { flags: "wx" }),
          );
          if (
            limit.bytes !== declaration.size ||
            (await stat(/* turbopackIgnore: true */ path)).size !==
              declaration.size ||
            (await sha256(path)) !== declaration.sha256
          ) {
            throw new RankingSourceIntegrityError(
              `${filename} does not match its LFS declaration`,
            );
          }
        }),
      );
      return {
        sha,
        sourceUpdatedAt: metadata.lastModified,
        directory,
        artifacts,
        temporary: true,
      };
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

function parsePointer(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("activeSha" in value) ||
    typeof value.activeSha !== "string" ||
    !FULL_SHA.test(value.activeSha) ||
    ("previousSha" in value &&
      value.previousSha !== undefined &&
      (typeof value.previousSha !== "string" ||
        !FULL_SHA.test(value.previousSha))) ||
    !("acceptedAt" in value) ||
    typeof value.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(value.acceptedAt)) ||
    !("sourceUpdatedAt" in value) ||
    typeof value.sourceUpdatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.sourceUpdatedAt))
  ) {
    throw new Error("Invalid ranking generation pointer");
  }
  return value as {
    activeSha: string;
    previousSha?: string;
    acceptedAt: string;
    sourceUpdatedAt: string;
  };
}

export class LocalRankingStore {
  constructor(private readonly root = resolve(tmpdir(), "ust-rankings")) {}

  private generationDirectory(sha: string) {
    return resolve(this.root, sha);
  }

  private async readJson(name: string) {
    try {
      return JSON.parse(
        await readFile(join(this.root, name), "utf8"),
      ) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async readPointer() {
    const value = await this.readJson("active.json");
    return value === undefined ? undefined : parsePointer(value);
  }

  async readFailure() {
    const value = await this.readJson("failure.json");
    if (value === undefined || value === null) return undefined;
    if (
      typeof value !== "object" ||
      !("class" in value) ||
      ![
        "configuration",
        "upstream",
        "integrity",
        "storage",
        "lock",
        "internal",
      ].includes(String(value.class)) ||
      !("at" in value) ||
      typeof value.at !== "string" ||
      !Number.isFinite(Date.parse(value.at))
    )
      throw new Error("Invalid ranking failure record");
    return value as {
      class:
        | "configuration"
        | "upstream"
        | "integrity"
        | "storage"
        | "lock"
        | "internal";
      at: string;
    };
  }

  private async writeJson(name: string, value: unknown) {
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, name);
    const staging = `${path}.${process.pid}.tmp`;
    await writeFile(staging, `${JSON.stringify(value)}\n`);
    await rename(staging, path);
  }

  async writeFailure(failure: { class: string; at: string } | undefined) {
    await this.writeJson("failure.json", failure ?? null);
  }

  async writePointer(pointer: ReturnType<typeof parsePointer>) {
    await this.writeJson("active.json", pointer);
    const keep = new Set([pointer.activeSha, pointer.previousSha]);
    for (const name of await readdir(this.root).catch(() => [])) {
      if (FULL_SHA.test(name) && !keep.has(name))
        await rm(join(this.root, name), { recursive: true, force: true });
    }
  }

  async downloadGeneration(sha: string) {
    if (!FULL_SHA.test(sha)) throw new Error("Invalid stored generation SHA");
    const base = this.generationDirectory(sha);
    try {
      const files = await Promise.all(
        ["manifest.json", ...ARTIFACTS].map((filename) =>
          stat(join(base, filename)),
        ),
      );
      if (files.every((file) => file.isFile())) return base;
    } catch {
      return undefined;
    }
    return undefined;
  }

  async removeCachedGeneration(sha: string) {
    if (!FULL_SHA.test(sha)) return;
    await rm(this.generationDirectory(sha), { recursive: true, force: true });
  }

  async putGeneration(sha: string, directory: string) {
    if (basename(resolve(directory)) !== sha)
      throw new Error("Generation directory is not commit-pinned");
    const destination = this.generationDirectory(sha);
    if (resolve(directory) === destination) return;
    const staging = await mkdtemp(join(tmpdir(), `stored-rankings-${sha}-`));
    let installed = false;
    try {
      for (const filename of ["manifest.json", ...ARTIFACTS]) {
        const maximum =
          filename === "manifest.json"
            ? MAX_MANIFEST_BYTES
            : MAX_ARTIFACT_BYTES;
        if ((await stat(join(directory, filename))).size > maximum)
          throw new Error("Ranking generation object exceeds its size bound");
        await copyFile(join(directory, filename), join(staging, filename));
      }
      await mkdir(this.root, { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      installed = true;
    } finally {
      if (!installed) await rm(staging, { recursive: true, force: true });
    }
  }
}

let localLock = Promise.resolve();

async function withLocalLock<T>(operation: () => Promise<T>) {
  const previous = localLock;
  let release = () => {};
  localLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function withPostgresLock<T>(operation: () => Promise<T>) {
  const url = optionalEnvironment("POSTGRES_URL");
  if (!url) return withLocalLock(operation);
  const sql = postgres(url, { max: 1 });
  const connection = await sql.reserve();
  try {
    const [row] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(1431520338, 36) AS acquired
    `;
    if (!row?.acquired) return undefined;
    try {
      return await operation();
    } finally {
      await connection`SELECT pg_advisory_unlock(1431520338, 36)`;
    }
  } finally {
    connection.release();
    await sql.end();
  }
}

export function productionRankingRefreshDependencies(): RankingRefreshDependencies {
  return {
    upstream: new HuggingFaceRankingSource(),
    store: new LocalRankingStore(),
    withLock: withPostgresLock,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}
