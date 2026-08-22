import { expect, test, vi } from "vitest";
import { loadCourseReviews, loadReviews } from "@/app/courses/review-data";
import { loadReview } from "@/app/reviews/review-data";
import { ContributionsUnavailableError } from "@/lib/contributions/reviews";

vi.mock("server-only", () => ({}));

const review = {
  id: "00000000-0000-4000-8000-000000000144",
  revisionId: "00000000-0000-4000-8000-000000000244",
  course: { coursePrefix: "COMP", courseNumber: "2000" },
  instructorUuid: "00000000-0000-4000-8000-000000000045",
  termCode: "2510",
  markdown: "Useful labs.",
  attribution: "attributed" as const,
  attributionCredit: "Captured Student",
  capturedDisplayName: "Captured Student",
  license: "CC BY 4.0" as const,
  publishedAt: new Date("2026-08-20T12:00:00.000Z"),
  instructorAssociationStatus: "resolved" as const,
};

test("Review reads cross one contribution seam and distinguish provider unavailability from zero Reviews", async () => {
  expect(await loadCourseReviews("COMP", "2000", async () => [review])).toEqual(
    { reviews: [review], signedIn: false, unavailable: false },
  );
  expect(
    await loadReviews(
      {
        type: "instructor",
        instructorUuids: [review.instructorUuid],
      },
      async () => {
        throw new ContributionsUnavailableError();
      },
    ),
  ).toEqual({ reviews: [], signedIn: false, unavailable: true });

  const programmingError = new TypeError("unexpected defect");
  await expect(
    loadCourseReviews("COMP", "2000", async () => {
      throw programmingError;
    }),
  ).rejects.toBe(programmingError);
});

test("Review reads reveal edit capability only to the authenticated author query", async () => {
  const userId = "00000000-0000-4000-8000-000000000044";
  const calls: unknown[] = [];
  const result = await loadReviews(
    { type: "course", coursePrefix: "COMP", courseNumber: "2000" },
    async (query, viewerUserId) => {
      calls.push({ query, viewerUserId });
      return [{ ...review, viewerCanEdit: viewerUserId === userId }];
    },
    async () => userId,
  );

  expect(calls).toEqual([
    {
      query: {
        type: "course",
        coursePrefix: "COMP",
        courseNumber: "2000",
      },
      viewerUserId: userId,
    },
  ]);
  expect(result.reviews[0]?.viewerCanEdit).toBe(true);
  expect(result.signedIn).toBe(true);
});

test("Review permalinks remain public without Auth configuration", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const calls: unknown[] = [];
    expect(
      await loadReview(review.id, async (reviewId, viewerUserId) => {
        calls.push({ reviewId, viewerUserId });
        return review;
      }),
    ).toEqual({ review, unavailable: false });
    expect(calls).toEqual([{ reviewId: review.id, viewerUserId: undefined }]);
  } finally {
    if (previousSecret) process.env.AUTH_SECRET = previousSecret;
  }
});
