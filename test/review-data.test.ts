import { expect, test, vi } from "vitest";
import { loadCourseReviews, loadReviews } from "@/app/courses/review-data";
import { loadReview } from "@/app/reviews/review-data";
import {
  ContributionsUnavailableError,
  normalizeContributionDate,
  reviewOrder,
} from "@/lib/contributions/reviews";

test("Review Order defaults invalid and absent input to Top", () => {
  expect(reviewOrder(undefined)).toBe("top");
  expect(reviewOrder("unknown")).toBe("top");
  expect(reviewOrder(["recent"])).toBe("top");
  expect(reviewOrder("popular")).toBe("popular");
  expect(reviewOrder("recent")).toBe("recent");
});

vi.mock("server-only", () => ({}));
const { auth, postgresGetReview, postgresListReviews } = vi.hoisted(() => ({
  auth: { userId: undefined as string | undefined },
  postgresGetReview: vi.fn(),
  postgresListReviews: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: (...args: unknown[]) => Promise<unknown>) => {
    const values = new Map<string, Promise<unknown>>();
    return (...args: unknown[]) => {
      const key = JSON.stringify(args);
      const existing = values.get(key);
      if (existing) return existing;
      const value = read(...args);
      values.set(key, value);
      return value;
    };
  },
}));
vi.mock("@/lib/auth/user", () => ({
  authenticatedUserId: async () => auth.userId,
}));
vi.mock("@/lib/contributions/postgres", () => ({
  getReviewService: () => ({
    getReview: postgresGetReview,
    listReviews: postgresListReviews,
  }),
}));

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

test("Review reads normalize cached timestamp strings", async () => {
  const serializedPublishedAt = "2026-08-20T12:00:00.000Z";
  postgresListReviews.mockReset();
  postgresListReviews.mockResolvedValue([
    { ...review, publishedAt: serializedPublishedAt as unknown as Date },
  ]);
  const list = await loadCourseReviews("COMP", "2000");
  expect(list.reviews[0]?.publishedAt).toEqual(review.publishedAt);
  expect(list.reviews[0]?.publishedAt).toBeInstanceOf(Date);

  postgresGetReview.mockReset();
  postgresGetReview.mockResolvedValue({
    ...review,
    publishedAt: serializedPublishedAt as unknown as Date,
  });
  const detail = await loadReview(review.id);
  expect(detail.review?.publishedAt).toEqual(review.publishedAt);
  expect(detail.review?.publishedAt).toBeInstanceOf(Date);
});

test("Review reads report invalid cached timestamps as unavailable", async () => {
  postgresListReviews.mockReset();
  postgresListReviews.mockResolvedValue([
    { ...review, publishedAt: "not-a-timestamp" as unknown as Date },
  ]);

  await expect(loadCourseReviews("COMP", "9999")).resolves.toEqual({
    reviews: [],
    signedIn: false,
    unavailable: true,
  });
});

test("Review reads bypass cached values in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  postgresListReviews.mockReset();
  postgresListReviews.mockResolvedValue([review]);
  const query = {
    type: "course" as const,
    coursePrefix: "COMP",
    courseNumber: "4000",
  };

  try {
    await loadReviews(query);
    await loadReviews(query);
    expect(postgresListReviews).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("Contribution dates normalize serialized values", () => {
  expect(normalizeContributionDate("2026-08-20T12:00:00.000Z")).toEqual(
    review.publishedAt,
  );
  expect(normalizeContributionDate(new Date(review.publishedAt))).toEqual(
    review.publishedAt,
  );
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

test("cached Review reads isolate each User's personalized result", async () => {
  postgresListReviews.mockReset();
  postgresListReviews.mockImplementation(
    async (_query: unknown, viewerUserId?: string) => [
      { ...review, viewerCanEdit: viewerUserId === "user-a" },
    ],
  );
  const query = {
    type: "course" as const,
    coursePrefix: "COMP",
    courseNumber: "3000",
  };

  await loadReviews(query, undefined, async () => "user-a");
  await loadReviews(query, undefined, async () => "user-a");
  await loadReviews(query, undefined, async () => "user-b");

  expect(postgresListReviews.mock.calls).toEqual([
    [query, "user-a"],
    [query, "user-b"],
  ]);
});

test("cached Review permalink reads isolate each User's personalized result", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "configured";
  postgresGetReview.mockReset();
  postgresGetReview.mockImplementation(
    async (_reviewId: string, viewerUserId?: string) => ({
      ...review,
      viewerCanEdit: viewerUserId === "user-a",
    }),
  );
  try {
    auth.userId = "user-a";
    await loadReview(review.id);
    await loadReview(review.id);
    auth.userId = "user-b";
    await loadReview(review.id);

    expect(postgresGetReview.mock.calls).toEqual([
      [review.id, "user-a"],
      [review.id, "user-b"],
    ]);
  } finally {
    auth.userId = undefined;
    if (previousSecret) process.env.AUTH_SECRET = previousSecret;
    else delete process.env.AUTH_SECRET;
  }
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
