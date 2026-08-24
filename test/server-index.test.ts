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
import {
  DELIVERY_ARTIFACTS,
  type ServerIndex,
} from "@/lib/server-index-contract";

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

function legacyManifest() {
  const sources = { rankings: SOURCE_COMMIT, schedule: SOURCE_COMMIT };
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
  return {
    generation,
    manifest: {
      schemaVersion: 1,
      generation,
      sources,
      artifacts: Object.fromEntries(
        DELIVERY_ARTIFACTS.map((name) => [
          name,
          {
            url: `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${generation}/${name}`,
            bytes: 1,
            sha256: hashes[name],
          },
        ]),
      ),
    },
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
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/manifest.json`;
  const indexUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/server-index.json.gz`;
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

test("startup fails closed until a verified legacy manifest proves no index was published", async () => {
  const {
    currentServerIndex,
    initializeServerIndex,
    resetServerIndexForTests,
    ServerIndexActivationError,
    ServerIndexUnavailableError,
  } = await import("@/lib/server-index");
  resetServerIndexForTests();
  await expect(
    initializeServerIndex(dependencies(new Map<string, BodyInit>())),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  await expect(currentServerIndex()).rejects.toBeInstanceOf(
    ServerIndexUnavailableError,
  );

  resetServerIndexForTests();
  const verifiedLegacy = legacyManifest();
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${verifiedLegacy.generation}/manifest.json`;
  const legacy = dependencies(
    new Map<string, BodyInit>([
      [
        "https://fixtures.test/latest.json",
        JSON.stringify({
          generation: verifiedLegacy.generation,
          manifest: manifestUrl,
        }),
      ],
      [manifestUrl, JSON.stringify(verifiedLegacy.manifest)],
    ]),
  );
  await expect(initializeServerIndex(legacy)).rejects.toBeInstanceOf(
    ServerIndexActivationError,
  );
  await expect(currentServerIndex()).resolves.toBeUndefined();

  resetServerIndexForTests();
  const malformed = legacyManifest();
  delete (malformed.manifest.artifacts as Record<string, unknown>)[
    DELIVERY_ARTIFACTS[0]
  ];
  const malformedUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${malformed.generation}/manifest.json`;
  await expect(
    initializeServerIndex(
      dependencies(
        new Map<string, BodyInit>([
          [
            "https://fixtures.test/latest.json",
            JSON.stringify({
              generation: malformed.generation,
              manifest: malformedUrl,
            }),
          ],
          [malformedUrl, JSON.stringify(malformed.manifest)],
        ]),
      ),
    ),
  ).rejects.toBeTruthy();
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
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/manifest.json`;
  const previousIndexUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${GENERATION}/server-index.json.gz`;
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

test("verified legacy recovery cannot erase a concurrent failed activation", async () => {
  const {
    activateServerIndex,
    currentServerIndex,
    initializeServerIndex,
    resetServerIndexForTests,
    ServerIndexActivationError,
    ServerIndexUnavailableError,
  } = await import("@/lib/server-index");
  resetServerIndexForTests();
  const legacy = legacyManifest();
  const manifestUrl = `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${legacy.generation}/manifest.json`;
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
    allowIndexUrl: () => true,
    request: vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://fixtures.test/latest.json")
        return Response.json({
          generation: legacy.generation,
          manifest: manifestUrl,
        });
      manifestRequested();
      await heldManifest;
      return Response.json(legacy.manifest);
    }),
  };
  const recovering = initializeServerIndex(recoveryDependencies);
  await requested;
  const candidate = artifact(serverIndex());
  await expect(
    activateServerIndex(
      { ...candidate.declaration, sha256: "f".repeat(64) },
      dependencies(
        new Map<string, BodyInit>([
          [candidate.declaration.indexUrl, candidate.bytes],
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(ServerIndexActivationError);
  releaseManifest();
  await expect(recovering).rejects.toBeInstanceOf(ServerIndexActivationError);
  await expect(currentServerIndex()).rejects.toBeInstanceOf(
    ServerIndexUnavailableError,
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
