import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { DeliveryManifest } from "@/lib/server-index-contract";
import {
  type PublicationDependencies,
  publishGeneration,
  rollbackGeneration,
} from "@/scripts/publish-delivery";

const generation = "a".repeat(64);
const previousGeneration = "d".repeat(64);
const cdn = "https://data.example.test";
const directories: string[] = [];

function manifest(value = generation): DeliveryManifest {
  return {
    schemaVersion: 1,
    generation: value,
    sources: { rankings: "1".repeat(40), schedule: "2".repeat(40) },
    artifacts: {
      "course-ratings.parquet": {
        url: `${cdn}/${value}/course-ratings.parquet`,
        bytes: 1,
        sha256: "b".repeat(64),
      },
    } as DeliveryManifest["artifacts"],
    serverIndex: {
      name: "server-index.json.gz",
      url: "server-index.json.gz",
      generation: value,
      bytes: 1,
      sha256: "c".repeat(64),
      identitySha256: "e".repeat(64),
    },
  };
}

function dependencies(events: string[]): PublicationDependencies {
  return {
    async put(key) {
      events.push(`put:${key}`);
    },
    async activate(input) {
      events.push(`activate:${input.generation}`);
    },
    async activeGeneration() {
      return undefined;
    },
    async verifyGeneration(value) {
      events.push(`verify-generation:${value}`);
    },
    async verifyLatest(value) {
      events.push(`verify-latest:${value}`);
    },
  };
}

function noCurrentPublication() {
  return async () => new Response(null, { status: 404 });
}

function publicationRequest(current = previousGeneration) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("latest.json"))
      return Response.json({
        schemaVersion: 1,
        generation: current,
        manifest: `${cdn}/${current}/manifest.json`,
      });
    const match = url.match(/\/([0-9a-f]{64})\/manifest\.json$/);
    return match
      ? Response.json(manifest(match[1]))
      : new Response(null, { status: 404 });
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "delivery-publish-"));
  directories.push(root);
  const directory = join(root, generation);
  await mkdir(directory);
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest()));
  await writeFile(join(directory, "server-index.json.gz"), "x");
  return directory;
}

afterEach(async () => {
  delete process.env.DATA_SPACES_CDN_BASE_URL;
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("publication verifies immutable files before activating and promoting", async () => {
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const events: string[] = [];
  await publishGeneration(
    await fixture(),
    dependencies(events),
    noCurrentPublication(),
  );
  expect(events).toEqual([
    `put:${generation}/manifest.json`,
    `put:${generation}/server-index.json.gz`,
    `verify-generation:${generation}`,
    `activate:${generation}`,
    "put:latest.json",
    `verify-latest:${generation}`,
  ]);
});

test("rollback verifies, activates the old index, then repoints latest", async () => {
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const events: string[] = [];
  await rollbackGeneration(
    generation,
    dependencies(events),
    publicationRequest(),
  );
  expect(events).toEqual([
    `verify-generation:${generation}`,
    `activate:${generation}`,
    "put:latest.json",
    `verify-latest:${generation}`,
  ]);
});

test("failed staged verification changes neither pointer", async () => {
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const events: string[] = [];
  const deps = dependencies(events);
  deps.verifyGeneration = async () => {
    events.push("verify-generation:failed");
    throw new Error("verification failed");
  };
  await expect(
    publishGeneration(await fixture(), deps, noCurrentPublication()),
  ).rejects.toThrow("verification failed");
  expect(events).not.toContain(`activate:${generation}`);
  expect(events).not.toContain("put:latest.json");
});

test("first publication confirms an ambiguous activation before promotion", async () => {
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const events: string[] = [];
  const deps = dependencies(events);
  deps.activate = async ({ generation: value }) => {
    events.push(`activate:${value}`);
    throw new Error("activation response lost");
  };
  deps.activeGeneration = async () => generation;
  await expect(
    publishGeneration(await fixture(), deps, noCurrentPublication()),
  ).resolves.toBe(generation);
  expect(events.slice(-4)).toEqual([
    `activate:${generation}`,
    `activate:${generation}`,
    "put:latest.json",
    `verify-latest:${generation}`,
  ]);
});

test("unconfirmed activation restores the previous publication", async () => {
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const events: string[] = [];
  const deps = dependencies(events);
  deps.activate = async ({ generation: value }) => {
    events.push(`activate:${value}`);
    if (value === generation) throw new Error("activation response lost");
  };
  await expect(
    publishGeneration(await fixture(), deps, publicationRequest()),
  ).rejects.toThrow("could not be confirmed");
  expect(events.slice(-3)).toEqual([
    `activate:${previousGeneration}`,
    "put:latest.json",
    `verify-latest:${previousGeneration}`,
  ]);
});

test("failed latest promotion restores the previous Server Index", async () => {
  process.env.DATA_SPACES_CDN_BASE_URL = cdn;
  const events: string[] = [];
  const deps = dependencies(events);
  let latestWrites = 0;
  deps.put = async (key) => {
    events.push(`put:${key}`);
    if (key === "latest.json" && latestWrites++ === 0)
      throw new Error("promotion failed");
  };
  await expect(
    publishGeneration(await fixture(), deps, publicationRequest()),
  ).rejects.toThrow("promotion failed");
  expect(events.slice(-3)).toEqual([
    `activate:${previousGeneration}`,
    "put:latest.json",
    `verify-latest:${previousGeneration}`,
  ]);
});
