import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import {
  createReviewService,
  type PublicReview,
  type ReviewRepository,
  type ReviewWriteError,
} from "@/lib/contributions/reviews";
import {
  createSignalService,
  type SignalRepository,
} from "@/lib/contributions/signals";
import type { ServerIndex } from "@/lib/server-index-contract";

vi.mock("server-only", () => ({}));

const GENERATION = "a".repeat(64);
const NEXT_GENERATION = "b".repeat(64);
const SOURCE_COMMIT = "1".repeat(40);
const SPLIT_COMMIT = "2".repeat(40);
const ALPHA_UUID = "00000000-0000-4000-8000-000000000001";
const RETIRED_UUID = "00000000-0000-4000-8000-000000000002";
const SPLIT_UUID = "00000000-0000-4000-8000-000000000003";
const USER_ID = "00000000-0000-4000-8000-000000000047";

function serverIndex(generation = GENERATION): ServerIndex {
  return {
    schemaVersion: 1,
    generation,
    courses: [
      { prefix: "COMP", number: "2000" },
      { prefix: "MATH", number: "1000" },
    ],
    instructors: [
      { uuid: ALPHA_UUID, canonicalName: "Alpha Instructor", itsc: "alpha" },
      { uuid: RETIRED_UUID, canonicalName: "Retired Instructor" },
      { uuid: SPLIT_UUID, canonicalName: "Split Instructor" },
    ],
    instructorAliases: [
      {
        uuid: ALPHA_UUID,
        name: "Alpha Instructor",
        source: "schedule",
        sourceCommit: SOURCE_COMMIT,
      },
      {
        uuid: RETIRED_UUID,
        name: "Retired Instructor",
        source: "ranking-generation",
        sourceCommit: SOURCE_COMMIT,
      },
      {
        uuid: SPLIT_UUID,
        name: "Split Instructor",
        source: "schedule",
        sourceCommit: SPLIT_COMMIT,
      },
    ],
    instructorIdentityEvents: [
      {
        type: "merge",
        retiredUuid: RETIRED_UUID,
        survivorUuid: ALPHA_UUID,
        sourceCommit: SOURCE_COMMIT,
      },
      {
        type: "split",
        sourceUuid: ALPHA_UUID,
        newUuid: SPLIT_UUID,
        sourceCommit: SPLIT_COMMIT,
      },
    ],
    instructorRedirects: [{ from: RETIRED_UUID, to: ALPHA_UUID }],
    associationCorrections: [
      {
        correctionType: "split",
        sourceCommit: SPLIT_COMMIT,
        targetUuid: SPLIT_UUID,
        sourceName: "Split Instructor",
        termCode: "2510",
        courseCode: "COMP 2000",
      },
    ],
    relations: [
      {
        uuid: ALPHA_UUID,
        termNumber: 100,
        termCode: "2510",
        courseCode: "COMP 2000",
      },
      {
        uuid: SPLIT_UUID,
        termNumber: 100,
        termCode: "2510",
        courseCode: "MATH 1000",
      },
    ],
    courseOfferings: [
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "comp-2000",
        courseCode: "COMP 2000",
      },
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "math-1000",
        courseCode: "MATH 1000",
      },
    ],
    classes: [
      {
        termNumber: 100,
        termCode: "2510",
        courseId: "comp-2000",
        section: "L1",
        classNumber: 1001,
        courseCode: "COMP 2000",
      },
      {
        termNumber: 100,
        termCode: "2510",
        courseId: "math-1000",
        section: "L1",
        classNumber: 2001,
        courseCode: "MATH 1000",
      },
    ],
    classInstructors: [
      {
        termCode: "2510",
        courseId: "comp-2000",
        section: "L1",
        classNumber: 1001,
        uuid: ALPHA_UUID,
        sourceName: "Alpha Instructor",
      },
      {
        termCode: "2510",
        courseId: "math-1000",
        section: "L1",
        classNumber: 2001,
        uuid: SPLIT_UUID,
        sourceName: "Split Instructor",
      },
    ],
  };
}

function artifact(index: ServerIndex) {
  const bytes = Uint8Array.from(
    gzipSync(`${JSON.stringify(index)}\n`, { level: 9 }),
  );
  return {
    bytes,
    declaration: {
      generation: index.generation,
      indexUrl: `https://fixtures.test/${index.generation}/server-index.json.gz`,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function dependencies(responses: Map<string, BodyInit>) {
  return {
    latestUrl: "https://fixtures.test/latest.json",
    allowIndexUrl: (url: URL) => url.origin === "https://fixtures.test",
    request: vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = responses.get(url);
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { status: 200 });
    }),
  };
}

afterEach(async () => {
  delete process.env.RANKINGS_REFRESH_SECRET;
  const { resetServerIndexForTests } = await import("@/lib/server-index");
  resetServerIndexForTests();
});

test("activation validates a complete index, is idempotent, and failed replacement retains the active generation", async () => {
  const {
    activateServerIndex,
    currentServerIndex,
    ServerIndexActivationError,
  } = await import("@/lib/server-index");
  const current = artifact(serverIndex());
  const request = dependencies(
    new Map<string, BodyInit>([[current.declaration.indexUrl, current.bytes]]),
  );

  await expect(
    activateServerIndex(current.declaration, request),
  ).resolves.toEqual({ status: "activated", generation: GENERATION });
  await expect(
    activateServerIndex(current.declaration, request),
  ).resolves.toEqual({ status: "current", generation: GENERATION });
  expect(request.request).toHaveBeenCalledTimes(1);

  const invalidHash = artifact(serverIndex(NEXT_GENERATION));
  await expect(
    activateServerIndex(
      { ...invalidHash.declaration, sha256: "f".repeat(64) },
      dependencies(
        new Map<string, BodyInit>([
          [invalidHash.declaration.indexUrl, invalidHash.bytes],
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  expect((await currentServerIndex())?.generation).toBe(GENERATION);

  await expect(
    activateServerIndex(
      invalidHash.declaration,
      dependencies(new Map<string, BodyInit>()),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  expect((await currentServerIndex())?.generation).toBe(GENERATION);

  await expect(
    activateServerIndex(
      { ...invalidHash.declaration, generation: "c".repeat(64) },
      dependencies(
        new Map<string, BodyInit>([
          [invalidHash.declaration.indexUrl, invalidHash.bytes],
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  expect((await currentServerIndex())?.generation).toBe(GENERATION);

  const incomplete = serverIndex(NEXT_GENERATION);
  incomplete.classes = [];
  const incompleteArtifact = artifact(incomplete);
  await expect(
    activateServerIndex(
      incompleteArtifact.declaration,
      dependencies(
        new Map<string, BodyInit>([
          [incompleteArtifact.declaration.indexUrl, incompleteArtifact.bytes],
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  expect((await currentServerIndex())?.generation).toBe(GENERATION);
});

test("startup recovers the last promoted index through latest and its manifest", async () => {
  const { initializeServerIndex, resetServerIndexForTests } = await import(
    "@/lib/server-index"
  );
  resetServerIndexForTests();
  const current = artifact(serverIndex());
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/manifest.json`;
  const request = dependencies(
    new Map<string, BodyInit>([
      [
        "https://fixtures.test/latest.json",
        JSON.stringify({ generation: GENERATION, manifest: manifestUrl }),
      ],
      [
        manifestUrl,
        JSON.stringify({
          schemaVersion: 1,
          generation: GENERATION,
          artifacts: {},
          sources: { rankings: SOURCE_COMMIT, schedule: SOURCE_COMMIT },
          serverIndex: {
            name: "server-index.json.gz",
            url: current.declaration.indexUrl,
            generation: GENERATION,
            bytes: current.declaration.bytes,
            sha256: current.declaration.sha256,
          },
        }),
      ],
      [current.declaration.indexUrl, current.bytes],
    ]),
  );

  await expect(initializeServerIndex(request)).resolves.toMatchObject({
    generation: GENERATION,
  });
  expect(request.request).toHaveBeenCalledTimes(3);
});

test("startup recovery cannot replace a concurrently activated generation", async () => {
  const {
    activateServerIndex,
    currentServerIndex,
    initializeServerIndex,
    resetServerIndexForTests,
  } = await import("@/lib/server-index");
  resetServerIndexForTests();
  const previous = artifact(serverIndex());
  const next = artifact(serverIndex(NEXT_GENERATION));
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/manifest.json`;
  let manifestRequested = () => {};
  const requested = new Promise<void>((resolve) => {
    manifestRequested = resolve;
  });
  let releaseManifest = () => {};
  const heldManifest = new Promise<void>((resolve) => {
    releaseManifest = resolve;
  });
  const recoveryDependencies = {
    latestUrl: "https://fixtures.test/latest.json",
    allowIndexUrl: (url: URL) => url.origin === "https://fixtures.test",
    request: vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://fixtures.test/latest.json")
        return Response.json({ generation: GENERATION, manifest: manifestUrl });
      if (url === manifestUrl) {
        manifestRequested();
        await heldManifest;
        return Response.json({
          schemaVersion: 1,
          generation: GENERATION,
          serverIndex: {
            name: "server-index.json.gz",
            url: previous.declaration.indexUrl,
            generation: GENERATION,
            bytes: previous.declaration.bytes,
            sha256: previous.declaration.sha256,
          },
        });
      }
      if (url === previous.declaration.indexUrl)
        return new Response(previous.bytes);
      return new Response("missing", { status: 404 });
    }),
  };

  const recovering = initializeServerIndex(recoveryDependencies);
  await requested;
  await activateServerIndex(
    next.declaration,
    dependencies(
      new Map<string, BodyInit>([[next.declaration.indexUrl, next.bytes]]),
    ),
  );
  releaseManifest();

  await expect(recovering).resolves.toMatchObject({
    generation: NEXT_GENERATION,
  });
  expect((await currentServerIndex())?.generation).toBe(NEXT_GENERATION);
  expect(recoveryDependencies.request).not.toHaveBeenCalledWith(
    previous.declaration.indexUrl,
    expect.anything(),
  );
});

test("Review and Signal writes use the active index and preserve redirects and scoped corrections", async () => {
  const { installServerIndexForTests } = await import("@/lib/server-index");
  installServerIndexForTests(serverIndex());
  const {
    resolveReviewInstructorAssociationStatus,
    validateReviewAssociations,
  } = await import("@/lib/contributions/review-associations");

  expect(
    await validateReviewAssociations({
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      instructorUuid: RETIRED_UUID,
      termCode: "2510",
      section: "L1",
    }),
  ).toEqual({
    course: { coursePrefix: "COMP", courseNumber: "2000" },
    instructorUuid: ALPHA_UUID,
    termCode: "2510",
    section: "L1",
  });
  expect(
    await validateReviewAssociations({
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      instructorUuid: SPLIT_UUID,
      termCode: "2510",
      section: "L1",
    }),
  ).toBeUndefined();

  const review = {
    id: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    instructorUuid: ALPHA_UUID,
    course: { coursePrefix: "COMP", courseNumber: "2000" },
    termCode: "2510",
    markdown: "Durable Review.",
    attribution: "attributed",
    attributionCredit: "Student",
    license: "CC BY 4.0",
    publishedAt: new Date(),
    instructorAssociationStatus: "resolved",
  } satisfies PublicReview;
  expect(await resolveReviewInstructorAssociationStatus(review)).toBe(
    "needs-resolution",
  );

  const published: PublicReview[] = [];
  const repository: ReviewRepository = {
    async publishReview(input) {
      const value: PublicReview = {
        id: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        ...input.associations,
        markdown: input.markdown,
        attribution: input.attribution,
        attributionCredit: "Student",
        license: "CC BY 4.0",
        publishedAt: new Date(),
      };
      published.push(value);
      return value;
    },
    async editReview() {
      throw new Error("not used");
    },
    async withdrawReview() {},
    async getReview() {
      return undefined;
    },
    async listReviews() {
      return [];
    },
  };
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "test-v1",
    validateAssociations: validateReviewAssociations,
  });
  await reviews.publishReview(USER_ID, {
    associations: { instructorUuid: RETIRED_UUID },
    markdown: "Merged identity.",
  });
  await expect(
    reviews.publishReview(USER_ID, {
      associations: {
        course: { coursePrefix: "COMP", courseNumber: "9999" },
      },
      markdown: "Unknown Course.",
    }),
  ).rejects.toMatchObject({
    code: "invalid-association",
  } satisfies Partial<ReviewWriteError>);
  expect(published[0]?.instructorUuid).toBe(ALPHA_UUID);

  const signalWrites: unknown[] = [];
  const signalRepository: SignalRepository = {
    async readSignals() {
      return {
        thumbs: { up: 0, down: 0 },
        emoji: {
          love: 0,
          laugh: 0,
          surprised: 0,
          confused: 0,
          sad: 0,
          angry: 0,
          fire: 0,
        },
      };
    },
    async setThumbs(userId, target, state) {
      signalWrites.push({ userId, target, state });
    },
    async setEmoji() {},
    async mergeInstructorSignals() {},
  };
  const active = installServerIndexForTests(serverIndex());
  const signals = createSignalService(signalRepository, {
    async resolveTarget(target) {
      return active.resolveSignalTarget(target);
    },
  });
  await signals.setThumbs(USER_ID, {
    target: { type: "instructor", instructorUuid: RETIRED_UUID },
    state: "up",
  });
  expect(signalWrites).toEqual([
    {
      userId: USER_ID,
      target: { type: "instructor", instructorUuid: ALPHA_UUID },
      state: "up",
    },
  ]);
});

test("production accepts only commit-pinned canonical Hugging Face Server Index URLs", async () => {
  const { isCanonicalServerIndexUrl } = await import("@/lib/server-index");
  expect(
    isCanonicalServerIndexUrl(
      new URL(
        `https://huggingface.co/datasets/ust-archive/ust-rankings/resolve/${SOURCE_COMMIT}/browser/${GENERATION}/server-index.json.gz`,
      ),
    ),
  ).toBe(true);
  for (const value of [
    `http://huggingface.co/datasets/ust-archive/ust-rankings/resolve/${SOURCE_COMMIT}/browser/${GENERATION}/server-index.json.gz`,
    `https://example.com/datasets/ust-archive/ust-rankings/resolve/${SOURCE_COMMIT}/browser/${GENERATION}/server-index.json.gz`,
    `https://huggingface.co/datasets/ust-archive/ust-rankings/resolve/main/browser/${GENERATION}/server-index.json.gz`,
    `https://huggingface.co/datasets/ust-archive/ust-rankings/resolve/${SOURCE_COMMIT}/browser/${GENERATION}/other.json.gz`,
  ])
    expect(isCanonicalServerIndexUrl(new URL(value))).toBe(false);
});
