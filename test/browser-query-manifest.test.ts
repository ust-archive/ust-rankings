import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { resolveDeliveryManifest } from "@/lib/browser-query/manifest";
import { DELIVERY_ARTIFACTS } from "@/lib/server-index-contract";

const baseUrl = "https://data.example.test";
const revision = "1".repeat(40);

function fixture() {
  const sources = { rankings: revision, schedule: "2".repeat(40) };
  const hashes = Object.fromEntries(
    DELIVERY_ARTIFACTS.map((name) => [
      name,
      createHash("sha256").update(name).digest("hex"),
    ]),
  ) as Record<(typeof DELIVERY_ARTIFACTS)[number], string>;
  const generation = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        sources,
        artifacts: DELIVERY_ARTIFACTS.map((name) => [name, hashes[name]]),
      }),
    )
    .digest("hex");
  const manifest = {
    schemaVersion: 1,
    generation,
    sources,
    artifacts: Object.fromEntries(
      DELIVERY_ARTIFACTS.map((name) => [
        name,
        {
          url: `${baseUrl}/${generation}/${name}`,
          bytes: 1,
          sha256: hashes[name],
        },
      ]),
    ),
    serverIndex: {
      name: "server-index.json.gz",
      url: "server-index.json.gz",
      generation,
      bytes: 1,
      sha256: "f".repeat(64),
    },
  };
  return { generation, manifest };
}

function request(value: ReturnType<typeof fixture>) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = url instanceof Request ? url.url : url.toString();
    if (href === `${baseUrl}/latest.json`)
      return Response.json({
        schemaVersion: 1,
        generation: value.generation,
        manifest: `${baseUrl}/${value.generation}/manifest.json`,
      });
    if (href === `${baseUrl}/${value.generation}/manifest.json`)
      return Response.json(value.manifest);
    return new Response("missing", { status: 404 });
  });
}

test("resolves and verifies one immutable Delivery manifest", async () => {
  const value = fixture();
  const fetch = request(value);
  await expect(resolveDeliveryManifest(baseUrl, fetch)).resolves.toMatchObject({
    baseUrl,
    generation: value.generation,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("rejects non-loopback HTTP delivery", async () => {
  await expect(
    resolveDeliveryManifest("http://data.example.test", request(fixture())),
  ).rejects.toThrow("Invalid dataset origin");
});

test.each([
  [
    "generation",
    (value: ReturnType<typeof fixture>) => {
      value.manifest.generation = "a".repeat(64);
    },
  ],
  [
    "artifact URL",
    (value: ReturnType<typeof fixture>) => {
      value.manifest.artifacts["courses.parquet"].url =
        "https://wrong.test/courses.parquet";
    },
  ],
  [
    "missing artifact",
    (value: ReturnType<typeof fixture>) => {
      delete (value.manifest.artifacts as Record<string, unknown>)[
        "relation.parquet"
      ];
    },
  ],
  [
    "artifact hash",
    (value: ReturnType<typeof fixture>) => {
      value.manifest.artifacts["courses.parquet"].sha256 = "a".repeat(64);
    },
  ],
] as const)("rejects an invalid %s", async (_label, mutate) => {
  const value = fixture();
  mutate(value);
  await expect(
    resolveDeliveryManifest(baseUrl, request(value)),
  ).rejects.toThrow();
});
