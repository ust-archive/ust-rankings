import { expect, test } from "bun:test";
import { loadCourseReviews } from "@/app/courses/review-data";
import { ContributionsUnavailableError } from "@/lib/contributions/reviews";

const review = {
  id: "00000000-0000-4000-8000-000000000144",
  revisionId: "00000000-0000-4000-8000-000000000244",
  coursePrefix: "COMP",
  courseNumber: "2000",
  markdown: "Useful labs.",
  capturedDisplayName: "Captured Student",
  publishedAt: new Date("2026-08-20T12:00:00.000Z"),
};

test("Course Review reads distinguish provider unavailability from zero Reviews", async () => {
  expect(await loadCourseReviews("COMP", "2000", async () => [review])).toEqual(
    { reviews: [review], unavailable: false },
  );
  expect(
    await loadCourseReviews("COMP", "2000", async () => {
      throw new ContributionsUnavailableError();
    }),
  ).toEqual({ reviews: [], unavailable: true });

  const programmingError = new TypeError("unexpected defect");
  await expect(
    loadCourseReviews("COMP", "2000", async () => {
      throw programmingError;
    }),
  ).rejects.toBe(programmingError);
});
