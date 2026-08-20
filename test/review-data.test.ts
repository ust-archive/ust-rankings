import { expect, test } from "bun:test";
import { loadCourseReviews, loadReviews } from "@/app/courses/review-data";
import { ContributionsUnavailableError } from "@/lib/contributions/reviews";

const review = {
  id: "00000000-0000-4000-8000-000000000144",
  revisionId: "00000000-0000-4000-8000-000000000244",
  course: { coursePrefix: "COMP", courseNumber: "2000" },
  instructorUuid: "00000000-0000-4000-8000-000000000045",
  termCode: "2510",
  markdown: "Useful labs.",
  capturedDisplayName: "Captured Student",
  publishedAt: new Date("2026-08-20T12:00:00.000Z"),
  instructorAssociationStatus: "resolved" as const,
};

test("Review reads cross one contribution seam and distinguish provider unavailability from zero Reviews", async () => {
  expect(await loadCourseReviews("COMP", "2000", async () => [review])).toEqual(
    { reviews: [review], unavailable: false },
  );
  expect(
    await loadReviews(
      {
        type: "instructor",
        instructorUuid: review.instructorUuid,
      },
      async () => {
        throw new ContributionsUnavailableError();
      },
    ),
  ).toEqual({ reviews: [], unavailable: true });

  const programmingError = new TypeError("unexpected defect");
  await expect(
    loadCourseReviews("COMP", "2000", async () => {
      throw programmingError;
    }),
  ).rejects.toBe(programmingError);
});
