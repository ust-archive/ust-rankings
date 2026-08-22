import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { PublicReview } from "@/lib/contributions/reviews";
import { fixtureSha, makeRankingGeneration } from "./rankings-fixture";
import { makeScheduleGeneration } from "./schedule-fixture";

vi.mock("server-only", () => ({}));

const ALPHA_UUID = "00000000-0000-4000-8000-000000000001";
const BETA_UUID = "00000000-0000-4000-8000-000000000002";
const temporaryDirectories: string[] = [];

async function configureAssociations() {
  const rankingRoot = await mkdtemp(join(tmpdir(), "review-rankings-"));
  const scheduleRoot = await mkdtemp(join(tmpdir(), "review-schedule-"));
  temporaryDirectories.push(rankingRoot, scheduleRoot);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    rankingRoot,
    undefined,
    { includeScheduleCourse: true },
  );
  const { resetScheduleRuntimeForTests } = await import(
    "@/lib/schedule/server"
  );
  await resetScheduleRuntimeForTests(
    await makeScheduleGeneration(scheduleRoot),
  );
}

async function updateManifest(
  update: (manifest: {
    identities: Array<Record<string, unknown>>;
    identityEvents?: unknown[];
  }) => void,
) {
  const path = join(process.env.RANKINGS_SEED_DIR as string, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  update(manifest);
  await writeFile(path, JSON.stringify(manifest));
}

afterEach(async () => {
  delete process.env.RANKINGS_SEED_DIR;
  const [{ resetRankingsRuntimeForTests }, { resetScheduleRuntimeForTests }] =
    await Promise.all([
      import("@/lib/rankings/server"),
      import("@/lib/schedule/server"),
    ]);
  await Promise.all([
    resetRankingsRuntimeForTests(),
    resetScheduleRuntimeForTests(),
    ...temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ]);
});

test("the production Review validator uses accepted Rankings and Schedule associations", async () => {
  await configureAssociations();
  const { validateReviewAssociations } = await import(
    "@/lib/contributions/review-associations"
  );
  const course = { coursePrefix: "COMP", courseNumber: "2000" };

  for (const associations of [
    { course },
    { instructorUuid: ALPHA_UUID },
    { instructorUuid: ALPHA_UUID, termCode: "2510" },
    { course, instructorUuid: ALPHA_UUID },
    { course, instructorUuid: ALPHA_UUID, termCode: "2510" },
    { course, instructorUuid: ALPHA_UUID, termCode: "2430" },
    { course, termCode: "2510", section: "L1" },
    {
      course,
      instructorUuid: ALPHA_UUID,
      termCode: "2510",
      section: "L1",
    },
  ])
    expect(await validateReviewAssociations(associations)).toEqual(
      associations,
    );

  for (const associations of [
    { instructorUuid: ALPHA_UUID, termCode: "2430" },
    { course, instructorUuid: BETA_UUID },
    { course, termCode: "2420" },
    { course, termCode: "2510", section: "L2" },
    {
      course,
      instructorUuid: BETA_UUID,
      termCode: "2510",
      section: "L1",
    },
  ])
    expect(await validateReviewAssociations(associations)).toBeUndefined();
});

test("production identity correction matching flags overlapping Reviews and preserves unrelated snapshots", async () => {
  await configureAssociations();
  const splitUuid = "00000000-0000-4000-8000-00000000000a";
  const splitIdentity = {
    uuid: splitUuid,
    canonicalName: "Split Instructor",
    aliases: [
      {
        name: "Split Source Name",
        source: "schedule",
        sourceCommit: fixtureSha,
      },
    ],
  };
  await updateManifest((manifest) => {
    manifest.identities.push(splitIdentity);
    manifest.identityEvents = [
      {
        type: "merge",
        retiredUuid: BETA_UUID,
        survivorUuid: ALPHA_UUID,
        sourceCommit: fixtureSha,
      },
      {
        type: "split",
        sourceUuid: ALPHA_UUID,
        newUuid: splitUuid,
        newIdentity: splitIdentity,
        sourceCommit: fixtureSha,
        affectedAssociations: [
          {
            sourceCommit: fixtureSha,
            sourceName: "Alpha Instructor",
            termCode: "2510",
            courseCode: "COMP 2000",
          },
        ],
      },
    ];
  });
  const { resolveReviewInstructorAssociationStatus } = await import(
    "@/lib/contributions/review-associations"
  );
  const review = (associations: Partial<PublicReview>): PublicReview => ({
    id: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    instructorUuid: ALPHA_UUID,
    markdown: "Durable Review.",
    attribution: "attributed",
    attributionCredit: "Captured Student",
    capturedDisplayName: "Captured Student",
    license: "CC BY 4.0",
    publishedAt: new Date("2026-08-20T12:00:00Z"),
    instructorAssociationStatus: "resolved",
    ...associations,
  });

  for (const associations of [
    {},
    { course: { coursePrefix: "COMP", courseNumber: "2000" } },
    { termCode: "2510" },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      termCode: "2510",
    },
  ])
    expect(
      await resolveReviewInstructorAssociationStatus(review(associations)),
    ).toBe("needs-resolution");

  expect(
    await resolveReviewInstructorAssociationStatus(
      review({ course: { coursePrefix: "COMP", courseNumber: "1000" } }),
    ),
  ).toBe("resolved");
  expect(
    await resolveReviewInstructorAssociationStatus(
      review({ termCode: "2430" }),
    ),
  ).toBe("resolved");
  expect(
    await resolveReviewInstructorAssociationStatus(
      review({
        instructorUuid: BETA_UUID,
        course: { coursePrefix: "MATH", courseNumber: "2000" },
        termCode: "2510",
      }),
    ),
  ).toBe("historical");
});
