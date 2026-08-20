import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";
import type { RankingRefreshDependencies } from "./server";

const ARTIFACTS = [
  "course-instructors.parquet",
  "course-rankings.parquet",
  "course-ratings.parquet",
  "instructor-rankings.parquet",
  "instructor-ratings.parquet",
] as const;
const FULL_SHA = /^[0-9a-f]{40}$/;
const LFS_SHA = /^[0-9a-f]{64}$/;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_GENERATION_BYTES = 256 * 1024 * 1024;

type TreeFile = {
  type?: unknown;
  path?: unknown;
  size?: unknown;
  lfs?: { oid?: unknown; size?: unknown };
};

type StoredBody = {
  transformToWebStream(): ReadableStream;
  transformToByteArray(): Promise<Uint8Array>;
};

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name} configuration`);
  return value;
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
        typeof entry.path === "string" && entry.path.endsWith(".parquet"),
    );
    if (
      JSON.stringify(parquet.map((entry) => entry.path).sort()) !==
      JSON.stringify(ARTIFACTS)
    ) {
      throw new RankingSourceIntegrityError(
        "Upstream tree is not a complete five-file generation",
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
          await pipeline(
            Readable.fromWeb(response.body as never),
            createWriteStream(path, { flags: "wx" }),
          );
          const declaration = artifacts[filename];
          if (
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

class SpacesRankingStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    const endpoint = new URL(requireEnvironment("RANKINGS_SPACE_ENDPOINT"));
    if (endpoint.protocol !== "https:")
      throw new Error("RANKINGS_SPACE_ENDPOINT must use HTTPS");
    this.bucket = requireEnvironment("RANKINGS_SPACE_BUCKET");
    this.prefix = (process.env.RANKINGS_SPACE_PREFIX ?? "rankings").replace(
      /^\/+|\/+$/g,
      "",
    );
    this.client = new S3Client({
      endpoint: endpoint.toString(),
      region: process.env.RANKINGS_SPACE_REGION ?? "sgp1",
      forcePathStyle: false,
      credentials: {
        accessKeyId: requireEnvironment("RANKINGS_SPACE_ACCESS_KEY_ID"),
        secretAccessKey: requireEnvironment("RANKINGS_SPACE_SECRET_ACCESS_KEY"),
      },
    });
  }

  private key(suffix: string) {
    return `${this.prefix}/${suffix}`;
  }

  private async bytes(key: string) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      if (!result.Body) throw new Error("Stored ranking object is empty");
      return await (result.Body as StoredBody).transformToByteArray();
    } catch (error) {
      if (
        ["NoSuchKey", "NotFound"].includes(
          (error as { name?: string }).name ?? "",
        )
      )
        return undefined;
      throw error;
    }
  }

  async readPointer() {
    const bytes = await this.bytes("active.json");
    return bytes
      ? parsePointer(JSON.parse(Buffer.from(bytes).toString("utf8")))
      : undefined;
  }

  async readFailure() {
    const bytes = await this.bytes("failure.json");
    if (!bytes) return undefined;
    const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (value === null) return undefined;
    if (
      typeof value !== "object" ||
      value === null ||
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

  async writeFailure(failure: { class: string; at: string } | undefined) {
    await this.put(
      "failure.json",
      Buffer.from(`${JSON.stringify(failure ?? null)}\n`),
      false,
    );
  }

  async writePointer(pointer: ReturnType<typeof parsePointer>) {
    await this.put(
      "active.json",
      Buffer.from(`${JSON.stringify(pointer)}\n`),
      false,
    );
  }

  async downloadGeneration(sha: string) {
    if (!FULL_SHA.test(sha)) throw new Error("Invalid stored generation SHA");
    const base = resolve(tmpdir(), "ust-rankings", sha);
    try {
      const files = await Promise.all(
        ["manifest.json", ...ARTIFACTS].map((filename) =>
          stat(join(base, filename)),
        ),
      );
      if (files.every((file) => file.isFile())) return base;
    } catch {
      await rm(base, { recursive: true, force: true });
    }
    const staging = await mkdtemp(join(tmpdir(), `stored-rankings-${sha}-`));
    try {
      await Promise.all(
        ["manifest.json", ...ARTIFACTS].map(async (filename) => {
          const result = await this.client.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: this.key(`generations/${sha}/${filename}`),
            }),
          );
          if (!result.Body)
            throw new Error("Stored ranking generation is incomplete");
          await pipeline(
            Readable.fromWeb(
              (result.Body as StoredBody).transformToWebStream() as never,
            ),
            createWriteStream(join(staging, filename), { flags: "wx" }),
          );
        }),
      );
      await mkdir(resolve(base, ".."), { recursive: true });
      try {
        await rename(staging, base);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      return base;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async putGeneration(sha: string, directory: string) {
    if (basename(resolve(directory)) !== sha)
      throw new Error("Generation directory is not commit-pinned");
    for (const filename of ["manifest.json", ...ARTIFACTS])
      await this.put(
        `generations/${sha}/${filename}`,
        await readFile(join(directory, filename)),
        true,
      );
  }

  private async put(key: string, body: Uint8Array, immutable: boolean) {
    if (immutable) {
      const existing = await this.bytes(key);
      if (existing) {
        if (!Buffer.from(existing).equals(Buffer.from(body)))
          throw new Error(
            "Immutable ranking object already exists with different bytes",
          );
        return;
      }
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: body,
        ContentType: "application/octet-stream",
      }),
    );
  }
}

async function withPostgresLock<T>(operation: () => Promise<T>) {
  const sql = postgres(requireEnvironment("POSTGRES_URL"), { max: 1 });
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
    store: new SpacesRankingStore(),
    withLock: withPostgresLock,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
  };
}
