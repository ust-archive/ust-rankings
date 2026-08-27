import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { resolveDeliveryManifest } from "@/lib/browser-query/manifest";
import {
  DELIVERY_ARTIFACTS,
  deliveryGenerationIdentityInput,
} from "@/lib/server-index-contract";

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
  const serverIndexIdentitySha256 = "e".repeat(64);
  const generation = createHash("sha256")
    .update(
      deliveryGenerationIdentityInput({
        sources,
        artifacts: Object.fromEntries(
          DELIVERY_ARTIFACTS.map((name) => [name, { sha256: hashes[name] }]),
        ) as Record<(typeof DELIVERY_ARTIFACTS)[number], { sha256: string }>,
        serverIndexIdentitySha256,
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
    waitlistEvidence: {
      artifact: "waitlist-evidence.parquet",
      schemaVersion: 1,
      modelVersion: "joint-baseline-v1",
      sourceArtifact: "classes_legacy.parquet",
      sourceRevision: "2".repeat(40),
      sourceAvailable: true,
      selectedModel: "baseline",
      priorWeight: 4,
      timing: {
        activation: "first-positive-wait",
        normalEnrollment: "official-registry",
        addDrop: "official-registry",
        sinceActivationBucketsHours: [12, 24, 48],
        sinceEnrollmentBucketDays: 2,
        untilAddDropBucketDays: 3,
      },
      tuning: {
        positions: [5, 25, 50],
        activationHours: [12, 24, 48],
        priorWeights: [0.5, 1, 2, 4, 8, 16, 32],
        holdout: "whole-term",
      },
      uncertainty: "estimated-bounded-margin-not-calibrated-interval",
      terms: [],
    },
    serverIndex: {
      name: "server-index.json.gz",
      url: "server-index.json.gz",
      generation,
      bytes: 1,
      sha256: "f".repeat(64),
      identitySha256: serverIndexIdentitySha256,
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

test("rejects missing Waitlist Evidence metadata", async () => {
  const value = fixture();
  delete (value.manifest as Record<string, unknown>).waitlistEvidence;
  await expect(
    resolveDeliveryManifest(baseUrl, request(value)),
  ).rejects.toThrow("Invalid Waitlist Evidence metadata");
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
  [
    "Waitlist prior weight",
    (value: ReturnType<typeof fixture>) => {
      value.manifest.waitlistEvidence.priorWeight = 2;
    },
  ],
] as const)("rejects an invalid %s", async (_label, mutate) => {
  const value = fixture();
  mutate(value);
  await expect(
    resolveDeliveryManifest(baseUrl, request(value)),
  ).rejects.toThrow();
});
