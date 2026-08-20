import { expect, test } from "bun:test";
import {
  type CourseReviewRepository,
  createReviewService,
  ReviewWriteError,
} from "@/lib/contributions/reviews";

const USER_ID = "00000000-0000-4000-8000-000000000044";

function fakeRepository() {
  const published: Parameters<
    CourseReviewRepository["publishCourseReview"]
  >[0][] = [];
  const repository: CourseReviewRepository = {
    async publishCourseReview(input) {
      published.push(input);
      return {
        id: "00000000-0000-4000-8000-000000000144",
        revisionId: "00000000-0000-4000-8000-000000000244",
        coursePrefix: input.coursePrefix,
        courseNumber: input.courseNumber,
        markdown: input.markdown,
        capturedDisplayName: "Public Student",
        publishedAt: new Date("2026-08-20T12:00:00.000Z"),
      };
    },
    async listCourseReviews() {
      return [];
    },
  };
  return { repository, published };
}

test("an active User publishes an attributed Course-only Review through the contribution seam", async () => {
  const { repository, published } = fakeRepository();
  const validated: Array<{ coursePrefix: string; courseNumber: string }> = [];
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "review-test-v1",
    async courseExists(course) {
      validated.push(course);
      return true;
    },
  });

  const review = await reviews.publishCourseReview(USER_ID, {
    coursePrefix: " comp ",
    courseNumber: " 2000 ",
    markdown: "The labs are **useful**.",
  });

  expect(validated).toEqual([{ coursePrefix: "COMP", courseNumber: "2000" }]);
  expect(published).toEqual([
    {
      userId: USER_ID,
      coursePrefix: "COMP",
      courseNumber: "2000",
      markdown: "The labs are **useful**.",
      policyVersion: "review-test-v1",
    },
  ]);
  expect(review.capturedDisplayName).toBe("Public Student");
});

test("invalid Courses and malformed text fail before publication", async () => {
  const { repository, published } = fakeRepository();
  const reviews = createReviewService(repository, {
    reviewPolicyVersion: "review-test-v1",
    async courseExists({ coursePrefix }) {
      return coursePrefix !== "MATH";
    },
  });

  for (const input of [
    { coursePrefix: "bad!", courseNumber: "2000", markdown: "Useful" },
    { coursePrefix: "COMP", courseNumber: "2000", markdown: "   " },
    { coursePrefix: "MATH", courseNumber: "1012", markdown: "Useful" },
  ])
    await expect(
      reviews.publishCourseReview(USER_ID, input),
    ).rejects.toBeInstanceOf(ReviewWriteError);
  expect(published).toHaveLength(0);
});
