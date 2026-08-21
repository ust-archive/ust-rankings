import { expect, test } from "vitest";
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
        attribution: input.attribution,
        attributionCredit:
          input.attribution === "attributed"
            ? "Public Student"
            : "Anonymous Reviewer",
        capturedDisplayName:
          input.attribution === "attributed" ? "Public Student" : undefined,
        license: "CC BY 4.0",
        publishedAt: new Date("2026-08-20T12:00:00.000Z"),
        instructorAssociationStatus: input.associations.instructorUuid
          ? "resolved"
          : undefined,
      };
    },
    async editReview() {
      throw new Error("not used");
    },
    async withdrawReview() {
      throw new Error("not used");
    },
    async getReview() {
      return undefined;
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

test("Instructor family aggregation normalizes UUIDs and de-duplicates each Review", async () => {
  const stored = {
    id: "00000000-0000-4000-8000-000000000144",
    revisionId: "00000000-0000-4000-8000-000000000244",
    instructorUuid: INSTRUCTOR_UUID,
    markdown: "Useful.",
    attribution: "attributed" as const,
    attributionCredit: "Public Student",
    capturedDisplayName: "Public Student",
    license: "CC BY 4.0" as const,
    publishedAt: new Date("2026-08-20T12:00:00.000Z"),
    instructorAssociationStatus: "resolved" as const,
  };
  const queries: Parameters<ReviewRepository["listReviews"]>[0][] = [];
  const repository: ReviewRepository = {
    async publishReview() {
      return stored;
    },
    async editReview() {
      throw new Error("not used");
    },
    async withdrawReview() {
      throw new Error("not used");
    },
    async getReview() {
      return stored;
    },
    async listReviews(query) {
      queries.push(query);
      return [stored, stored];
    },
  };
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "review-test-v1",
    async validateAssociations(associations) {
      return associations;
    },
  });

  expect(
    await reviews.listReviews({
      type: "instructor",
      instructorUuids: [INSTRUCTOR_UUID.toUpperCase(), INSTRUCTOR_UUID],
    }),
  ).toEqual([stored]);
  expect(queries).toEqual([
    { type: "instructor", instructorUuids: [INSTRUCTOR_UUID] },
  ]);
});

test("durable Review associations are flagged rather than guessed after an Instructor correction", async () => {
  const stored = {
    id: "00000000-0000-4000-8000-000000000144",
    revisionId: "00000000-0000-4000-8000-000000000244",
    course: { coursePrefix: "COMP", courseNumber: "2000" },
    instructorUuid: INSTRUCTOR_UUID,
    termCode: "2510",
    markdown: "Useful.",
    attribution: "attributed" as const,
    attributionCredit: "Public Student",
    capturedDisplayName: "Public Student",
    license: "CC BY 4.0" as const,
    publishedAt: new Date("2026-08-20T12:00:00.000Z"),
    instructorAssociationStatus: "resolved" as const,
  };
  const repository: ReviewRepository = {
    async publishReview() {
      return stored;
    },
    async editReview() {
      throw new Error("not used");
    },
    async withdrawReview() {
      throw new Error("not used");
    },
    async getReview() {
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

test("a Review author publishes optimistic attributed and Identity-hidden Revisions and withdraws", async () => {
  const revision = {
    id: "00000000-0000-4000-8000-000000000144",
    revisionId: "00000000-0000-4000-8000-000000000244",
    course: { coursePrefix: "COMP", courseNumber: "2000" },
    markdown: "Original.",
    attribution: "attributed" as const,
    attributionCredit: "Captured Student",
    capturedDisplayName: "Captured Student",
    license: "CC BY 4.0" as const,
    publishedAt: new Date("2026-08-20T12:00:00.000Z"),
    viewerCanEdit: true,
  };
  const edits: unknown[] = [];
  const withdrawals: unknown[] = [];
  const repository: ReviewRepository = {
    async publishReview() {
      return revision;
    },
    async editReview(input) {
      edits.push(input);
      return {
        ...revision,
        revisionId: "00000000-0000-4000-8000-000000000245",
        ...input.associations,
        markdown: input.markdown,
        attribution: "identity-hidden",
        attributionCredit: "Anonymous Reviewer",
        capturedDisplayName: undefined,
      };
    },
    async withdrawReview(input) {
      withdrawals.push(input);
    },
    async getReview() {
      return revision;
    },
    async listReviews() {
      return [revision];
    },
  };
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "review-test-v1",
    async validateAssociations(associations) {
      return associations;
    },
  });

  const edited = await reviews.editReview(USER_ID, revision.id, {
    expectedRevisionId: revision.revisionId,
    associations: { instructorUuid: INSTRUCTOR_UUID },
    markdown: "Edited.",
    attribution: "identity-hidden",
  });
  expect(edited).toMatchObject({
    markdown: "Edited.",
    attribution: "identity-hidden",
    attributionCredit: "Anonymous Reviewer",
  });
  expect(edits).toEqual([
    {
      userId: USER_ID,
      reviewId: revision.id,
      expectedRevisionId: revision.revisionId,
      associations: { instructorUuid: INSTRUCTOR_UUID },
      markdown: "Edited.",
      attribution: "identity-hidden",
      policyVersion: "review-test-v1",
    },
  ]);

  await reviews.withdrawReview(USER_ID, revision.id, edited.revisionId);
  expect(withdrawals).toEqual([
    {
      userId: USER_ID,
      reviewId: revision.id,
      expectedRevisionId: edited.revisionId,
    },
  ]);
});

test("a stable Review identity resolves only its current public Revision", async () => {
  const current = {
    id: "00000000-0000-4000-8000-000000000144",
    revisionId: "00000000-0000-4000-8000-000000000245",
    instructorUuid: INSTRUCTOR_UUID,
    markdown: "Current Revision.",
    attribution: "identity-hidden" as const,
    attributionCredit: "Anonymous Reviewer",
    license: "CC BY 4.0" as const,
    publishedAt: new Date("2026-08-20T13:00:00.000Z"),
  };
  const repository = {
    async publishReview() {
      return current;
    },
    async editReview() {
      return current;
    },
    async withdrawReview() {},
    async getReview(reviewId: string) {
      return reviewId === current.id ? current : undefined;
    },
    async listReviews() {
      return [];
    },
  } as ReviewRepository & {
    getReview(reviewId: string): Promise<typeof current | undefined>;
  };
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "review-test-v1",
    async validateAssociations(associations) {
      return associations;
    },
  });

  expect(await reviews.getReview(current.id)).toEqual(current);
  expect(
    await reviews.getReview("00000000-0000-4000-8000-000000000999"),
  ).toBeUndefined();
  await expect(reviews.getReview("bad")).rejects.toMatchObject({
    code: "review-not-found",
  });
});

test("Review edits validate identifiers, attribution, Markdown, and reassociation before persistence", async () => {
  let edits = 0;
  let validations = 0;
  const repository: ReviewRepository = {
    async publishReview() {
      throw new Error("not used");
    },
    async editReview() {
      edits += 1;
      throw new Error("must not persist");
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
    reviewPolicyVersion: "review-test-v1",
    async validateAssociations() {
      validations += 1;
      return undefined;
    },
  });
  const valid = {
    expectedRevisionId: "00000000-0000-4000-8000-000000000244",
    associations: { course: { coursePrefix: "COMP", courseNumber: "2000" } },
    markdown: "Edited.",
    attribution: "attributed" as const,
  };

  for (const input of [
    { ...valid, expectedRevisionId: "bad" },
    { ...valid, markdown: " " },
    { ...valid, attribution: "anonymous" },
  ])
    await expect(
      reviews.editReview(USER_ID, crypto.randomUUID(), input as typeof valid),
    ).rejects.toBeInstanceOf(ReviewWriteError);
  await expect(
    reviews.editReview(USER_ID, crypto.randomUUID(), valid),
  ).rejects.toMatchObject({ code: "invalid-association" });
  expect(validations).toBe(1);
  expect(edits).toBe(0);
});

test("Review text can publish without Attachments and rejects a fifth Attachment", async () => {
  const { reviews, published } = service();
  await reviews.publishReview(USER_ID, {
    associations: { course: { coursePrefix: "COMP", courseNumber: "2000" } },
    markdown: "Text while an upload is pending.",
  });
  expect(published[0]?.markdown).toBe("Text while an upload is pending.");
  expect(published[0]?.attachments).toBeUndefined();
  await expect(
    reviews.publishReview(USER_ID, {
      associations: { course: { coursePrefix: "COMP", courseNumber: "2000" } },
      markdown: "Too many files.",
      attachments: Array.from({ length: 5 }, () => ({
        storedFileId: "00000000-0000-4000-8000-000000000248",
        filename: "photo.jpg",
        description: "Lab",
      })),
    }),
  ).rejects.toMatchObject({ code: "invalid-review" });
});
