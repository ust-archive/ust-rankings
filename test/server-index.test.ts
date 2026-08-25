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
import {
  ALPHA_INSTRUCTOR_UUID as ALPHA_UUID,
  SERVER_INDEX_GENERATION as GENERATION,
  NEXT_SERVER_INDEX_GENERATION as NEXT_GENERATION,
  RETIRED_INSTRUCTOR_UUID as RETIRED_UUID,
  SERVER_INDEX_SOURCE_COMMIT as SOURCE_COMMIT,
  SPLIT_INSTRUCTOR_UUID as SPLIT_UUID,
  serverIndexFixture as serverIndex,
} from "./server-index-fixture";

vi.mock("server-only", () => ({}));

const USER_ID = "00000000-0000-4000-8000-000000000047";

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
    allowIndexUrl: (url: URL) =>
      [
        "https://fixtures.test",
        "https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com",
      ].includes(url.origin),
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

test("the active index serves static Instructor identity and names", async () => {
  const { installServerIndexForTests } = await import("@/lib/server-index");
  const index = installServerIndexForTests(serverIndex());

  expect(index.instructorIdentity(RETIRED_UUID)).toMatchObject({
    generation: GENERATION,
    instructor: { uuid: ALPHA_UUID, canonicalName: "Alpha Instructor" },
    familyUuids: [ALPHA_UUID, RETIRED_UUID],
    route: { canonicalKey: "alpha", redirect: true },
  });
  expect(index.instructorIdentity("ALPHA")?.route.redirect).toBe(false);
  expect(index.instructorIdentity(SPLIT_UUID)?.identityHistory).toMatchObject({
    associationCorrections: [
      { correctionType: "split", status: "needs-resolution" },
    ],
  });
  expect(index.instructorIdentity("unknown")).toBeUndefined();
  expect(
    index.instructorNamesForUuids([RETIRED_UUID, SPLIT_UUID, "unknown"]),
  ).toEqual(
    new Map([
      [RETIRED_UUID, "Alpha Instructor"],
      [SPLIT_UUID, "Split Instructor"],
    ]),
  );
});

test("static contribution pages keep UUID labels while the index is unavailable", async () => {
  const { instructorNamesForUuids } = await import("@/lib/server-index");

  await expect(instructorNamesForUuids([ALPHA_UUID])).resolves.toEqual(
    new Map(),
  );
});

test("first activation gates validators and fails closed when no previous index exists", async () => {
  const {
    activateServerIndex,
    currentServerIndex,
    resetServerIndexForTests,
    ServerIndexActivationError,
    ServerIndexUnavailableError,
  } = await import("@/lib/server-index");
  resetServerIndexForTests();
  const current = artifact(serverIndex());
  let requested = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = {
    latestUrl: "https://fixtures.test/latest.json",
    allowIndexUrl: () => true,
    request: vi.fn(async () => {
      requested();
      await held;
      return new Response(current.bytes);
    }),
  };

  const activating = activateServerIndex(current.declaration, request);
  await requestStarted;
  const reading = currentServerIndex();
  let settled = false;
  void reading.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await expect(activating).resolves.toMatchObject({ status: "activated" });
  await expect(reading).resolves.toMatchObject({ generation: GENERATION });

  resetServerIndexForTests();
  await expect(
    activateServerIndex(
      { ...current.declaration, sha256: "f".repeat(64) },
      dependencies(
        new Map<string, BodyInit>([
          [current.declaration.indexUrl, current.bytes],
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  await expect(currentServerIndex()).rejects.toBeInstanceOf(
    ServerIndexUnavailableError,
  );
  const { validateReviewAssociations } = await import(
    "@/lib/contributions/review-associations"
  );
  await expect(
    validateReviewAssociations({
      course: { coursePrefix: "COMP", courseNumber: "2000" },
    }),
  ).rejects.toMatchObject({ code: "rankings-unavailable" });
});

test("startup recovers the last promoted index through latest and its manifest", async () => {
  const { initializeServerIndex, resetServerIndexForTests } = await import(
    "@/lib/server-index"
  );
  resetServerIndexForTests();
  const current = artifact(serverIndex());
  const manifestUrl = `https://fixtures.test/${GENERATION}/manifest.json`;
  const indexUrl = current.declaration.indexUrl;
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
            url: "server-index.json.gz",
            generation: GENERATION,
            bytes: current.declaration.bytes,
            sha256: current.declaration.sha256,
          },
        }),
      ],
      [indexUrl, current.bytes],
    ]),
  );

  await expect(initializeServerIndex(request)).resolves.toMatchObject({
    generation: GENERATION,
  });
  expect(request.request).toHaveBeenCalledTimes(3);
});

test("startup requires a paired manifest with a Server Index", async () => {
  const {
    currentServerIndex,
    initializeServerIndex,
    resetServerIndexForTests,
    ServerIndexActivationError,
    ServerIndexUnavailableError,
  } = await import("@/lib/server-index");
  resetServerIndexForTests();
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/manifest.json`;
  await expect(
    initializeServerIndex(
      dependencies(
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
              sources: { rankings: SOURCE_COMMIT, schedule: SOURCE_COMMIT },
              artifacts: {},
            }),
          ],
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  await expect(currentServerIndex()).rejects.toBeInstanceOf(
    ServerIndexUnavailableError,
  );
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
  const manifestUrl = `https://fixtures.test/${GENERATION}/manifest.json`;
  const previousIndexUrl = previous.declaration.indexUrl;
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
    allowIndexUrl: (url: URL) =>
      [
        "https://fixtures.test",
        "https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com",
      ].includes(url.origin),
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
            url: "server-index.json.gz",
            generation: GENERATION,
            bytes: previous.declaration.bytes,
            sha256: previous.declaration.sha256,
          },
        });
      }
      if (url === previousIndexUrl) return new Response(previous.bytes);
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
    previousIndexUrl,
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

test("production accepts only immutable Spaces Server Index URLs", async () => {
  const { isImmutableServerIndexUrl } = await import("@/lib/server-index");
  const valid = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/server-index.json.gz`;
  expect(isImmutableServerIndexUrl(new URL(valid))).toBe(true);
  for (const value of [
    valid.replace("https:", "http:"),
    `https://example.com/${GENERATION}/server-index.json.gz`,
    "https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/latest/server-index.json.gz",
    `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/other.json.gz`,
    `${valid}?credential=secret`,
  ])
    expect(isImmutableServerIndexUrl(new URL(value))).toBe(false);
});
