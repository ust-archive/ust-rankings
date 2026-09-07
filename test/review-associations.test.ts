import { afterEach, expect, test, vi } from "vitest";
import type { PublicReview } from "@/lib/contributions/reviews";
import {
  ALPHA_INSTRUCTOR_UUID,
  RETIRED_INSTRUCTOR_UUID,
  SPLIT_INSTRUCTOR_UUID,
  serverIndexFixture,
} from "./server-index-fixture";

vi.mock("server-only", () => ({}));

afterEach(async () => {
  const { resetServerIndexForTests } = await import("@/lib/server-index");
  resetServerIndexForTests();
});

test("the production Review validator uses the active Server Index", async () => {
  const { installServerIndexForTests } = await import("@/lib/server-index");
  installServerIndexForTests(serverIndexFixture());
  const { validateReviewAssociations } = await import(
    "@/lib/contributions/review-associations"
  );
  const course = { coursePrefix: "COMP", courseNumber: "2000" };

  for (const associations of [
    { course },
    { instructorUuid: ALPHA_INSTRUCTOR_UUID },
    { instructorUuid: ALPHA_INSTRUCTOR_UUID, termCode: "2510" },
    { course, instructorUuid: ALPHA_INSTRUCTOR_UUID },
    { course, instructorUuid: ALPHA_INSTRUCTOR_UUID, termCode: "2510" },
    { course, termCode: "2510", section: "L1" },
    {
      course,
      instructorUuid: ALPHA_INSTRUCTOR_UUID,
      termCode: "2510",
      section: "L1",
    },
  ])
    expect(await validateReviewAssociations(associations)).toEqual(
      associations,
    );

  for (const associations of [
    { instructorUuid: ALPHA_INSTRUCTOR_UUID, termCode: "2430" },
    { course, instructorUuid: SPLIT_INSTRUCTOR_UUID },
    { course, termCode: "2420" },
    { course, termCode: "2510", section: "L2" },
    {
      course,
      instructorUuid: SPLIT_INSTRUCTOR_UUID,
      termCode: "2510",
      section: "L1",
    },
  ])
    expect(await validateReviewAssociations(associations)).toBeUndefined();
});

test("Instructor correction matching flags overlapping Reviews and preserves unrelated snapshots", async () => {
  const { installServerIndexForTests } = await import("@/lib/server-index");
  installServerIndexForTests(serverIndexFixture());
  const { resolveReviewInstructorAssociationStatus } = await import(
    "@/lib/contributions/review-associations"
  );
  const review = (associations: Partial<PublicReview>): PublicReview => ({
    id: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    instructorUuid: ALPHA_INSTRUCTOR_UUID,
    markdown: "Durable Review.",
    attribution: "attributed",
    attributionCredit: "Captured Student",
    capturedDisplayName: "Captured Student",
    license: "CC BY 4.0",
    publishedAt: new Date("2026-08-20T12:00:00Z"),
    instructorAssociationStatus: "resolved",
    ...associations,
  });

  expect(
    await resolveReviewInstructorAssociationStatus(
      review({
        course: { coursePrefix: "COMP", courseNumber: "2000" },
        termCode: "2510",
      }),
    ),
  ).toBe("needs-resolution");
  expect(
    await resolveReviewInstructorAssociationStatus(
      review({ course: { coursePrefix: "MATH", courseNumber: "1000" } }),
    ),
  ).toBe("resolved");
  expect(
    await resolveReviewInstructorAssociationStatus(
      review({
        instructorUuid: SPLIT_INSTRUCTOR_UUID,
        course: { coursePrefix: "COMP", courseNumber: "2000" },
        termCode: "2510",
      }),
    ),
  ).toBe("resolved");
  expect(
    await resolveReviewInstructorAssociationStatus(
      review({
        instructorUuid: RETIRED_INSTRUCTOR_UUID,
        course: { coursePrefix: "MATH", courseNumber: "1000" },
      }),
    ),
  ).toBe("historical");
});
