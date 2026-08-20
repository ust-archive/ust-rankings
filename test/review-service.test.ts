import { expect, test } from "bun:test";
import {
  createReviewService,
  type ReviewAssociations,
  type ReviewRepository,
  ReviewWriteError,
} from "@/lib/contributions/reviews";

const USER_ID = "00000000-0000-4000-8000-000000000044";
const INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000045";

function fakeRepository() {
  const published: Parameters<ReviewRepository["publishReview"]>[0][] = [];
  const repository: ReviewRepository = {
    async publishReview(input) {
      published.push(input);
      return {
        id: "00000000-0000-4000-8000-000000000144",
        revisionId: "00000000-0000-4000-8000-000000000244",
        ...input.associations,
        markdown: input.markdown,
        capturedDisplayName: "Public Student",
        publishedAt: new Date("2026-08-20T12:00:00.000Z"),
        instructorAssociationStatus: input.associations.instructorUuid
          ? "resolved"
          : undefined,
      };
    },
    async listReviews() {
      return [];
    },
  };
  return { repository, published };
}

function service(
  validateAssociations: (
    associations: ReviewAssociations,
  ) => Promise<ReviewAssociations | undefined> = async (associations) =>
    associations,
) {
  const fake = fakeRepository();
  return {
    ...fake,
    reviews: createReviewService(fake.repository, {
      reviewPolicyVersion: "review-test-v1",
      validateAssociations,
    }),
  };
}

test("a User publishes every valid normalized Review Basis and Review Context shape", async () => {
  const { reviews, published } = service();
  const shapes: ReviewAssociations[] = [
    { course: { coursePrefix: "COMP", courseNumber: "2000" } },
    { instructorUuid: INSTRUCTOR_UUID },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      instructorUuid: INSTRUCTOR_UUID,
    },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      termCode: "2510",
    },
    { instructorUuid: INSTRUCTOR_UUID, termCode: "2510" },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      instructorUuid: INSTRUCTOR_UUID,
      termCode: "2510",
    },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      termCode: "2510",
      section: "L1",
    },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      instructorUuid: INSTRUCTOR_UUID,
      termCode: "2510",
      section: "L1",
    },
  ];

  for (const associations of shapes)
    await reviews.publishReview(USER_ID, {
      associations,
      markdown: "The labs are **useful**.",
    });

  expect(published.map(({ associations }) => associations)).toEqual(shapes);
});

test("Review publication normalizes structured values before source validation", async () => {
  const validated: ReviewAssociations[] = [];
  const canonicalUuid = "00000000-0000-4000-8000-000000000046";
  const { reviews, published } = service(async (associations) => {
    validated.push(associations);
    return { ...associations, instructorUuid: canonicalUuid };
  });

  await reviews.publishReview(USER_ID, {
    associations: {
      course: { coursePrefix: " comp ", courseNumber: " 2000 " },
      instructorUuid: INSTRUCTOR_UUID.toUpperCase(),
      termCode: " 2510 ",
      section: " l1 ",
    },
    markdown: "Useful.",
  });

  expect(validated).toEqual([
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      instructorUuid: INSTRUCTOR_UUID,
      termCode: "2510",
      section: "L1",
    },
  ]);
  expect(published[0]?.associations.instructorUuid).toBe(canonicalUuid);
});

test("invalid Review Basis and Review Context shapes fail before source validation", async () => {
  let validations = 0;
  const { reviews, published } = service(async (associations) => {
    validations += 1;
    return associations;
  });
  const invalid: unknown[] = [
    {},
    { course: { coursePrefix: "bad!", courseNumber: "2000" } },
    { instructorUuid: "not-a-uuid" },
    { termCode: "2510" },
    { instructorUuid: INSTRUCTOR_UUID, section: "L1" },
    {
      instructorUuid: INSTRUCTOR_UUID,
      termCode: "2510",
      section: "L1",
    },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      section: "L1",
    },
    {
      course: { coursePrefix: "COMP", courseNumber: "2000" },
      termCode: "Fall 2025",
    },
  ];

  for (const associations of invalid)
    await expect(
      reviews.publishReview(USER_ID, {
        associations: associations as ReviewAssociations,
        markdown: "Useful.",
      }),
    ).rejects.toBeInstanceOf(ReviewWriteError);

  expect(validations).toBe(0);
  expect(published).toHaveLength(0);
});

test("durable Review associations are flagged rather than guessed after an Instructor correction", async () => {
  const stored = {
    id: "00000000-0000-4000-8000-000000000144",
    revisionId: "00000000-0000-4000-8000-000000000244",
    course: { coursePrefix: "COMP", courseNumber: "2000" },
    instructorUuid: INSTRUCTOR_UUID,
    termCode: "2510",
    markdown: "Useful.",
    capturedDisplayName: "Public Student",
    publishedAt: new Date("2026-08-20T12:00:00.000Z"),
    instructorAssociationStatus: "resolved" as const,
  };
  const repository: ReviewRepository = {
    async publishReview() {
      return stored;
    },
    async listReviews() {
      return [stored];
    },
  };
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "review-test-v1",
    async validateAssociations(associations) {
      return associations;
    },
    async resolveInstructorAssociationStatus() {
      return "needs-resolution";
    },
  });

  expect(
    await reviews.listReviews({
      type: "course",
      coursePrefix: "COMP",
      courseNumber: "2000",
    }),
  ).toEqual([{ ...stored, instructorAssociationStatus: "needs-resolution" }]);
});

test("unsupported source associations and malformed text fail before publication", async () => {
  const { reviews, published } = service(async () => undefined);
  await expect(
    reviews.publishReview(USER_ID, {
      associations: {
        course: { coursePrefix: "COMP", courseNumber: "2000" },
        instructorUuid: INSTRUCTOR_UUID,
      },
      markdown: "Useful.",
    }),
  ).rejects.toMatchObject({ code: "invalid-association" });
  await expect(
    reviews.publishReview(USER_ID, {
      associations: { instructorUuid: INSTRUCTOR_UUID },
      markdown: "   ",
    }),
  ).rejects.toMatchObject({ code: "invalid-review" });
  expect(published).toHaveLength(0);
});
