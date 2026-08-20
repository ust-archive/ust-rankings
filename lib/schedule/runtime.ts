import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
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
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";
import type { ScheduleRefreshDependencies } from "./server";

const ARTIFACTS = ["classes.parquet", "courses.parquet"] as const;
const FULL_SHA = /^[0-9a-f]{40}$/;
const LFS_SHA = /^[0-9a-f]{64}$/;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_GENERATION_BYTES = 192 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type TreeFile = {
  type?: unknown;
  path?: unknown;
  size?: unknown;
  lfs?: { oid?: unknown; size?: unknown };
};

type StoredBody = { transformToWebStream(): ReadableStream };

class ScheduleSourceIntegrityError extends Error {
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
        new ScheduleSourceIntegrityError(
          "Schedule object exceeds its declared size",
        ),
      );
      return;
    }
    callback(null, chunk);
  }
}

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

export class HuggingFaceScheduleSource {
  constructor(private readonly request: Fetch = fetch) {}

  async download(requestedSha?: string) {
    if (requestedSha !== undefined && !FULL_SHA.test(requestedSha))
      throw new Error("A full immutable commit SHA is required");
    const revision = requestedSha ?? "main";
    const metadata = (await responseJson(
      await this.request(
        `https://huggingface.co/api/datasets/ust-archive/schedule/revision/${revision}`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) },
      ),
    )) as { sha?: unknown; lastModified?: unknown };
    if (
      typeof metadata.sha !== "string" ||
      !FULL_SHA.test(metadata.sha) ||
      (requestedSha !== undefined && metadata.sha !== requestedSha) ||
      typeof metadata.lastModified !== "string" ||
      !Number.isFinite(Date.parse(metadata.lastModified))
    )
      throw new ScheduleSourceIntegrityError(
        "Upstream revision metadata is not immutable",
      );
    const sha = metadata.sha;
    const tree = await responseJson(
      await this.request(
        `https://huggingface.co/api/datasets/ust-archive/schedule/tree/${sha}?recursive=true&expand=true`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) },
      ),
    );
    if (!Array.isArray(tree))
      throw new ScheduleSourceIntegrityError("Invalid upstream tree response");
    const parquet = (tree as TreeFile[]).filter(
      (entry) =>
        typeof entry.path === "string" && entry.path.endsWith(".parquet"),
    );
    if (
      JSON.stringify(parquet.map((entry) => entry.path).sort()) !==
      JSON.stringify(ARTIFACTS)
    )
      throw new ScheduleSourceIntegrityError(
        "Upstream tree is not a complete two-file Schedule generation",
      );
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
      )
        throw new ScheduleSourceIntegrityError(
          "Invalid upstream LFS declaration",
        );
      totalSize += entry.size;
      artifacts[entry.path] = { sha256: entry.lfs.oid, size: entry.size };
    }
    if (totalSize > MAX_GENERATION_BYTES)
      throw new ScheduleSourceIntegrityError(
        "Schedule generation exceeds the local resource bound",
      );

    const stagingRoot = await mkdtemp(join(tmpdir(), `schedule-${sha}-`));
    const directory = join(stagingRoot, sha);
    await mkdir(directory);
    try {
      await Promise.all(
        ARTIFACTS.map(async (filename) => {
          const response = await this.request(
            `https://huggingface.co/datasets/ust-archive/schedule/resolve/${sha}/${filename}`,
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
          )
            throw new ScheduleSourceIntegrityError(
              `${filename} does not match its LFS declaration`,
            );
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
  )
    throw new Error("Invalid Schedule generation pointer");
  return value as {
    activeSha: string;
    previousSha?: string;
    acceptedAt: string;
    sourceUpdatedAt: string;
  };
}

function parseStoredManifest(value: unknown, sha: string) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("sourceCommit" in value) ||
    value.sourceCommit !== sha ||
    !("artifacts" in value) ||
    typeof value.artifacts !== "object" ||
    value.artifacts === null ||
    JSON.stringify(Object.keys(value.artifacts).sort()) !==
      JSON.stringify(ARTIFACTS)
  )
    throw new Error("Invalid stored Schedule manifest");
  const artifacts = value.artifacts as Record<
    string,
    { sha256?: unknown; size?: unknown }
  >;
  let total = 0;
  for (const filename of ARTIFACTS) {
    const declaration = artifacts[filename];
    if (
      typeof declaration?.sha256 !== "string" ||
      !LFS_SHA.test(declaration.sha256) ||
      typeof declaration.size !== "number" ||
      !Number.isSafeInteger(declaration.size) ||
      declaration.size <= 0 ||
      declaration.size > MAX_ARTIFACT_BYTES
    )
      throw new Error("Invalid stored Schedule artifact declaration");
    total += declaration.size;
  }
  if (total > MAX_GENERATION_BYTES)
    throw new Error("Stored Schedule generation exceeds its size bound");
  return artifacts as Record<string, { sha256: string; size: number }>;
}

export class SpacesScheduleStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(client?: S3Client) {
    const endpoint = new URL(requireEnvironment("SCHEDULE_SPACE_ENDPOINT"));
    if (endpoint.protocol !== "https:")
      throw new Error("SCHEDULE_SPACE_ENDPOINT must use HTTPS");
    this.bucket = requireEnvironment("SCHEDULE_SPACE_BUCKET");
    this.prefix = (process.env.SCHEDULE_SPACE_PREFIX ?? "schedule").replace(
      /^\/+|\/+$/g,
      "",
    );
    this.client =
      client ??
      new S3Client({
        endpoint: endpoint.toString(),
        region: process.env.SCHEDULE_SPACE_REGION ?? "sgp1",
        forcePathStyle: false,
        credentials: {
          accessKeyId: requireEnvironment("SCHEDULE_SPACE_ACCESS_KEY_ID"),
          secretAccessKey: requireEnvironment(
            "SCHEDULE_SPACE_SECRET_ACCESS_KEY",
          ),
        },
      });
  }

  private key(suffix: string) {
    return `${this.prefix}/${suffix}`;
  }

  private async bytes(key: string, maximum = MAX_METADATA_BYTES) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      if (!result.Body) throw new Error("Stored Schedule object is empty");
      if (result.ContentLength !== undefined && result.ContentLength > maximum)
        throw new Error("Stored Schedule object exceeds its size bound");
      const limit = new ByteLimit(maximum);
      const chunks: Buffer[] = [];
      for await (const chunk of Readable.fromWeb(
        (result.Body as StoredBody).transformToWebStream() as never,
      ).pipe(limit))
        chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
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
    return bytes ? parsePointer(JSON.parse(bytes.toString("utf8"))) : undefined;
  }

  async writePointer(pointer: ReturnType<typeof parsePointer>) {
    await this.put(
      "active.json",
      Buffer.from(`${JSON.stringify(pointer)}\n`),
      false,
    );
  }

  async readFailure() {
    const bytes = await this.bytes("failure.json");
    if (!bytes) return undefined;
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
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
      throw new Error("Invalid Schedule failure record");
    return value as Awaited<
      ReturnType<ScheduleRefreshDependencies["store"]["readFailure"]>
    >;
  }

  async writeFailure(failure: { class: string; at: string } | undefined) {
    await this.put(
      "failure.json",
      Buffer.from(`${JSON.stringify(failure ?? null)}\n`),
      false,
    );
  }

  async downloadGeneration(sha: string) {
    if (!FULL_SHA.test(sha)) throw new Error("Invalid stored generation SHA");
    const base = resolve(tmpdir(), "ust-schedule", sha);
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
    const staging = await mkdtemp(join(tmpdir(), `stored-schedule-${sha}-`));
    try {
      const manifestBytes = await this.bytes(
        `generations/${sha}/manifest.json`,
        MAX_MANIFEST_BYTES,
      );
      if (!manifestBytes)
        throw new Error("Stored Schedule generation is incomplete");
      const artifacts = parseStoredManifest(
        JSON.parse(manifestBytes.toString("utf8")),
        sha,
      );
      await writeFile(join(staging, "manifest.json"), manifestBytes, {
        flag: "wx",
      });
      await Promise.all(
        ARTIFACTS.map(async (filename) => {
          const declaration = artifacts[filename];
          const result = await this.client.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: this.key(`generations/${sha}/${filename}`),
            }),
          );
          if (!result.Body)
            throw new Error("Stored Schedule generation is incomplete");
          if (
            result.ContentLength !== undefined &&
            result.ContentLength > declaration.size
          )
            throw new Error(
              "Stored Schedule artifact exceeds its declared size",
            );
          const limit = new ByteLimit(declaration.size);
          await pipeline(
            Readable.fromWeb(
              (result.Body as StoredBody).transformToWebStream() as never,
            ),
            limit,
            createWriteStream(
              join(/* turbopackIgnore: true */ staging, filename),
              { flags: "wx" },
            ),
          );
          if (limit.bytes !== declaration.size)
            throw new Error("Stored Schedule artifact size mismatch");
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

  async removeCachedGeneration(sha: string) {
    if (!FULL_SHA.test(sha)) return;
    await rm(resolve(tmpdir(), "ust-schedule", sha), {
      recursive: true,
      force: true,
    });
  }

  async putGeneration(sha: string, directory: string) {
    if (basename(resolve(directory)) !== sha)
      throw new Error("Generation directory is not commit-pinned");
    for (const filename of ["manifest.json", ...ARTIFACTS]) {
      const body = await readFile(join(directory, filename));
      const maximum =
        filename === "manifest.json" ? MAX_MANIFEST_BYTES : MAX_ARTIFACT_BYTES;
      if (body.length > maximum)
        throw new Error("Schedule generation object exceeds its size bound");
      await this.put(`generations/${sha}/${filename}`, body, true);
    }
  }

  private async put(key: string, body: Uint8Array, immutable: boolean) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(key),
          Body: body,
          ContentType: "application/octet-stream",
          IfNoneMatch: immutable ? "*" : undefined,
        }),
      );
      return;
    } catch (error) {
      if (
        !immutable ||
        ((error as { name?: string }).name !== "PreconditionFailed" &&
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 412)
      )
        throw error;
    }
    const existing = await this.bytes(key, body.length);
    if (!existing || !Buffer.from(existing).equals(Buffer.from(body)))
      throw new Error(
        "Immutable Schedule object already exists with different bytes",
      );
  }
}

async function withPostgresLock<T>(operation: () => Promise<T>) {
  const sql = postgres(requireEnvironment("POSTGRES_URL"), { max: 1 });
  const connection = await sql.reserve();
  try {
    const [row] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(1431520338, 40) AS acquired
    `;
    if (!row?.acquired) return undefined;
    try {
      return await operation();
    } finally {
      await connection`SELECT pg_advisory_unlock(1431520338, 40)`;
    }
  } finally {
    connection.release();
    await sql.end();
  }
}

export function productionScheduleRefreshDependencies(): ScheduleRefreshDependencies {
  return {
    upstream: new HuggingFaceScheduleSource(),
    store: new SpacesScheduleStore(),
    withLock: withPostgresLock,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
  };
}
