import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import {
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { DeliveryManifest } from "@/lib/server-index-contract";

const GENERATION = /^[0-9a-f]{64}$/;
const CORS_ORIGIN = "https://ust-rankings.invalid";
const contentTypes: Record<string, string> = {
  ".gz": "application/gzip",
  ".json": "application/json",
  ".parquet": "application/vnd.apache.parquet",
};

type LatestPointer = {
  schemaVersion: number;
  generation: string;
  manifest: string;
};

type PutOptions = {
  cacheControl: string;
  contentLength: number;
  contentType: string;
  immutable?: boolean;
  sha256: string;
};

export type PublicationDependencies = {
  prepare?(): Promise<void>;
  put(
    key: string,
    body: Uint8Array | Readable,
    options: PutOptions,
  ): Promise<void>;
  activate(input: {
    generation: string;
    indexUrl: string;
    bytes: number;
    sha256: string;
  }): Promise<void>;
  activeGeneration(): Promise<string | undefined>;
  verifyGeneration(
    generation: string,
    manifest: DeliveryManifest,
  ): Promise<void>;
  verifyLatest(generation: string): Promise<void>;
};

function extension(name: string) {
  return name.slice(name.lastIndexOf("."));
}

function digest(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

function latestPointer(
  generation: string,
  schemaVersion: number,
): LatestPointer {
  return {
    schemaVersion,
    generation,
    manifest: `${process.env.DATA_SPACES_CDN_BASE_URL}/${generation}/manifest.json`,
  };
}

function latestBody(pointer: LatestPointer) {
  return Buffer.from(`${JSON.stringify(pointer)}\n`);
}

function activation(manifest: DeliveryManifest) {
  return {
    generation: manifest.generation,
    indexUrl: `${process.env.DATA_SPACES_CDN_BASE_URL}/${manifest.generation}/${manifest.serverIndex.name}`,
    bytes: manifest.serverIndex.bytes,
    sha256: manifest.serverIndex.sha256,
  };
}

async function fetchManifest(
  generation: string,
  request: typeof fetch,
): Promise<DeliveryManifest> {
  if (!GENERATION.test(generation))
    throw new Error("Invalid Delivery generation");
  const response = await request(
    `${process.env.DATA_SPACES_CDN_BASE_URL}/${generation}/manifest.json`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error("Delivery manifest is unavailable");
  const manifest = (await response.json()) as DeliveryManifest;
  if (manifest.generation !== generation)
    throw new Error("Delivery manifest mismatch");
  return manifest;
}

async function currentPublication(request: typeof fetch) {
  const response = await request(
    `${process.env.DATA_SPACES_CDN_BASE_URL}/latest.json`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error("Current Delivery pointer is unavailable");
  const latest = (await response.json()) as LatestPointer;
  const manifest = await fetchManifest(latest.generation, request);
  if (!manifest.serverIndex) return undefined;
  return { latest, manifest };
}

async function putLatest(
  pointer: LatestPointer,
  dependencies: PublicationDependencies,
) {
  const body = latestBody(pointer);
  await dependencies.put("latest.json", body, {
    cacheControl: "no-cache",
    contentLength: body.byteLength,
    contentType: "application/json",
    sha256: digest(body),
  });
  await dependencies.verifyLatest(pointer.generation);
}

async function activateConfirmed(
  input: ReturnType<typeof activation>,
  dependencies: PublicationDependencies,
) {
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await dependencies.activate(input);
    } catch (error) {
      errors.push(error);
    }
    for (let poll = 0; poll < 30; poll += 1) {
      try {
        if ((await dependencies.activeGeneration()) === input.generation)
          return;
      } catch (error) {
        errors.push(error);
      }
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  throw new AggregateError(
    errors,
    "Server Index activation could not be confirmed",
  );
}

async function restorePublication(
  previous: Awaited<ReturnType<typeof currentPublication>>,
  dependencies: PublicationDependencies,
) {
  if (!previous) return;
  await activateConfirmed(activation(previous.manifest), dependencies);
  await putLatest(previous.latest, dependencies);
}

export async function publishGeneration(
  directory: string,
  dependencies: PublicationDependencies,
  request: typeof fetch = fetch,
) {
  await dependencies.prepare?.();
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  ) as DeliveryManifest;
  if (
    !GENERATION.test(manifest.generation) ||
    basename(resolve(directory)) !== manifest.generation
  )
    throw new Error("Invalid Delivery generation directory");
  const previous = await currentPublication(request);
  const files = (await readdir(directory)).sort();
  for (const name of files) {
    const path = resolve(directory, name);
    const body = await readFile(path);
    await dependencies.put(
      `${manifest.generation}/${name}`,
      createReadStream(path),
      {
        cacheControl: "public, max-age=31536000, immutable",
        contentLength: (await stat(path)).size,
        contentType:
          contentTypes[extension(name)] ?? "application/octet-stream",
        immutable: true,
        sha256: digest(body),
      },
    );
  }
  await dependencies.verifyGeneration(manifest.generation, manifest);
  try {
    await activateConfirmed(activation(manifest), dependencies);
    await putLatest(
      latestPointer(manifest.generation, manifest.schemaVersion),
      dependencies,
    );
  } catch (error) {
    try {
      await restorePublication(previous, dependencies);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Publication and recovery failed",
      );
    }
    throw error;
  }
  return manifest.generation;
}

export async function rollbackGeneration(
  generation: string,
  dependencies: PublicationDependencies,
  request: typeof fetch = fetch,
) {
  await dependencies.prepare?.();
  const previous = await currentPublication(request);
  const manifest = await fetchManifest(generation, request);
  await dependencies.verifyGeneration(generation, manifest);
  try {
    await activateConfirmed(activation(manifest), dependencies);
    await putLatest(
      latestPointer(generation, manifest.schemaVersion),
      dependencies,
    );
  } catch (error) {
    try {
      await restorePublication(previous, dependencies);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Rollback and recovery failed",
      );
    }
    throw error;
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertHeader(response: Response, name: string, value: RegExp) {
  const actual = response.headers.get(name) ?? "";
  if (!value.test(actual)) throw new Error(`CDN ${name} header is invalid`);
}

async function retryAcceptance(check: () => Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5)
        await new Promise((done) => setTimeout(done, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

function productionDependencies(): PublicationDependencies {
  const bucket = required("DATA_SPACES_BUCKET");
  const cdn = required("DATA_SPACES_CDN_BASE_URL").replace(/\/+$/, "");
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const endpoint = required("DATA_SPACES_ENDPOINT");
  const region = required("DATA_SPACES_REGION");
  const accessKeyId = required("DATA_SPACES_ACCESS_KEY_ID");
  const secretAccessKey = required("DATA_SPACES_SECRET_ACCESS_KEY");
  const activationUrl = required("SERVER_INDEX_ACTIVATION_URL");
  const activationSecret = required("RANKINGS_REFRESH_SECRET");
  const s3 = new S3Client({
    endpoint,
    region,
    forcePathStyle: false,
    credentials: { accessKeyId, secretAccessKey },
  });
  async function head(key: string) {
    return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  }
  return {
    async prepare() {
      try {
        await s3.send(
          new PutBucketCorsCommand({
            Bucket: bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedHeaders: ["Range"],
                  AllowedMethods: ["GET", "HEAD"],
                  AllowedOrigins: ["*"],
                  ExposeHeaders: [
                    "Accept-Ranges",
                    "Content-Length",
                    "Content-Range",
                    "ETag",
                  ],
                  MaxAgeSeconds: 86_400,
                },
              ],
            },
          }),
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 403
        )
          throw error;
      }
    },
    async put(key, body, options) {
      if (options.immutable) {
        try {
          const existing = await head(key);
          if (
            existing.ContentLength === options.contentLength &&
            existing.Metadata?.sha256 === options.sha256
          )
            return;
          throw new Error(`Immutable object conflict: ${key}`);
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 404
          )
            throw error;
        }
      }
      await s3.send(
        new PutObjectCommand({
          ACL: "public-read",
          Bucket: bucket,
          Key: key,
          Body: body,
          CacheControl: options.cacheControl,
          ContentLength: options.contentLength,
          ContentType: options.contentType,
          Metadata: { sha256: options.sha256 },
        }),
      );
      const stored = await head(key);
      if (
        stored.ContentLength !== options.contentLength ||
        stored.Metadata?.sha256 !== options.sha256
      )
        throw new Error(`Uploaded object verification failed: ${key}`);
    },
    async activate(input) {
      const response = await fetch(activationUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${activationSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => undefined)) as
          | { failureClass?: unknown }
          | undefined;
        const failure =
          typeof result?.failureClass === "string"
            ? ` (${result.failureClass})`
            : "";
        throw new Error(
          `Server Index activation returned HTTP ${response.status}${failure}`,
        );
      }
      const result = (await response.json()) as { generation?: unknown };
      if (result.generation !== input.generation)
        throw new Error("Server Index activation generation mismatch");
    },
    async activeGeneration() {
      const response = await fetch(activationUrl, {
        headers: { authorization: `Bearer ${activationSecret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 405 || response.status === 503) return undefined;
      if (!response.ok)
        throw new Error(`Server Index status returned HTTP ${response.status}`);
      const result = (await response.json()) as { generation?: unknown };
      return typeof result.generation === "string"
        ? result.generation
        : undefined;
    },
    async verifyGeneration(generation, manifest) {
      await retryAcceptance(async () => {
        const signal = AbortSignal.timeout(15_000);
        const manifestResponse = await fetch(
          `${cdn}/${generation}/manifest.json`,
          {
            headers: { origin: CORS_ORIGIN },
            cache: "no-store",
            signal,
          },
        );
        if (!manifestResponse.ok)
          throw new Error("CDN manifest is unavailable");
        assertHeader(manifestResponse, "access-control-allow-origin", /^\*$/);
        assertHeader(
          manifestResponse,
          "cache-control",
          /max-age=31536000.*immutable/i,
        );
        assertHeader(manifestResponse, "content-type", /^application\/json\b/i);
        const served = (await manifestResponse.json()) as DeliveryManifest;
        if (
          served.generation !== generation ||
          served.serverIndex.sha256 !== manifest.serverIndex.sha256
        )
          throw new Error("CDN manifest content mismatch");

        const range = await fetch(
          manifest.artifacts["course-ratings.parquet"].url,
          {
            headers: { origin: CORS_ORIGIN, range: "bytes=0-99" },
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (range.status !== 206) throw new Error("CDN range request failed");
        assertHeader(range, "access-control-allow-origin", /^\*$/);
        assertHeader(range, "cache-control", /max-age=31536000.*immutable/i);
        assertHeader(range, "content-range", /^bytes 0-99\/\d+$/i);
        assertHeader(
          range,
          "content-type",
          /^application\/vnd\.apache\.parquet\b/i,
        );
      });
    },
    async verifyLatest(generation) {
      await retryAcceptance(async () => {
        const response = await fetch(`${cdn}/latest.json`, {
          headers: { origin: CORS_ORIGIN },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error("CDN latest pointer is unavailable");
        assertHeader(response, "access-control-allow-origin", /^\*$/);
        assertHeader(response, "cache-control", /no-cache/i);
        assertHeader(response, "content-type", /^application\/json\b/i);
        const latest = (await response.json()) as LatestPointer;
        if (latest.generation !== generation)
          throw new Error("CDN latest pointer mismatch");
      });
    },
  };
}

async function main() {
  const [action, value] = process.argv.slice(2);
  const dependencies = productionDependencies();
  if (action === "publish" && value)
    await publishGeneration(resolve(value), dependencies);
  else if (action === "rollback" && value)
    await rollbackGeneration(value, dependencies);
  else
    throw new Error(
      "Usage: node scripts/publish-delivery.ts publish <directory> | rollback <generation>",
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
