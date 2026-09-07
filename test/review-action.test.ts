import { expect, test, vi } from "vitest";
import { ReviewWriteError } from "@/lib/contributions/reviews";

let origin: string | null = "https://rankings.example";
let userId: string | undefined;
let publicationError: unknown;
const published: unknown[] = [];
const edited: unknown[] = [];
const withdrawn: unknown[] = [];
const { updateTag } = vi.hoisted(() => ({ updateTag: vi.fn() }));

vi.mock("next/cache", () => ({ updateTag }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      host: "rankings.example",
      ...(origin ? { origin } : {}),
    }),
}));
vi.mock("@/lib/auth/user", () => ({
  authenticatedUserId: async () => userId,
}));
vi.mock("@/lib/contributions/postgres", () => ({
  getModerationService: () => ({
    async reportReview() {
      throw new Error("not used");
    },
  }),
  getReviewService: () => ({
    async publishReview(id: string, input: unknown) {
      if (publicationError) throw publicationError;
      published.push({ id, input });
    },
    async editReview(id: string, reviewId: string, input: unknown) {
      if (publicationError) throw publicationError;
      edited.push({ id, reviewId, input });
    },
    async withdrawReview(
      id: string,
      reviewId: string,
      expectedRevisionId: string,
    ) {
      if (publicationError) throw publicationError;
      withdrawn.push({ id, reviewId, expectedRevisionId });
    },
    async listReviews() {
      const { ContributionsUnavailableError } = await import(
        "@/lib/contributions/reviews"
      );
      throw new ContributionsUnavailableError();
    },
  }),
}));

function form(markdown: string | Blob = "Useful labs.") {
  const data = new FormData();
  data.set("course", "COMP|2000");
  data.set("markdown", markdown);
  return data;
}

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
    throw new Error("Mutation did not redirect");
  } catch (error) {
    return String((error as { digest?: string }).digest);
  }
}

test("Review action denies cross-origin and signed-out writes before publication", async () => {
  const { publishReview } = await import("@/app/courses/review-actions");
  published.length = 0;
  userId = "00000000-0000-4000-8000-000000000044";
  origin = "https://evil.example";
  expect(await redirectOf(() => publishReview(null, form()))).toContain(
    "/courses/COMP/2000?reviewError=cross-origin#reviews",
  );
  expect(published).toHaveLength(0);

  origin = "https://rankings.example";
  userId = undefined;
  expect(await redirectOf(() => publishReview(null, form()))).toContain(
    "/auth/login?r=%2Fcourses%2FCOMP%2F2000",
  );
  expect(published).toHaveLength(0);
});

test("Review action rejects File-valued Markdown before publication", async () => {
  const { publishReview } = await import("@/app/courses/review-actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000044";
  publicationError = undefined;
  published.length = 0;

  expect(
    await redirectOf(() =>
      publishReview(
        null,
        form(
          new File(["not text input"], "review.txt", { type: "text/plain" }),
        ),
      ),
    ),
  ).toContain("/courses/COMP/2000?reviewError=invalid-review#reviews");
  expect(published).toHaveLength(0);

  const malformedCourse = form();
  malformedCourse.set("course", new File(["COMP|2000"], "course.txt"));
  expect(
    await redirectOf(() => publishReview(null, malformedCourse)),
  ).toContain("/rankings/courses?reviewError=invalid-basis#reviews");
  const malformedContext = form();
  malformedContext.set("termCode", new File(["2510"], "term.txt"));
  expect(
    await redirectOf(() => publishReview(null, malformedContext)),
  ).toContain("/courses/COMP/2000?reviewError=invalid-context#reviews");
  expect(published).toHaveLength(0);
});

test("Review action publishes for an authenticated User and routes onboarding failures", async () => {
  const { publishReview } = await import("@/app/courses/review-actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000044";
  publicationError = undefined;
  published.length = 0;
  updateTag.mockClear();
  expect(await redirectOf(() => publishReview(null, form()))).toContain(
    "/courses/COMP/2000?review=published#reviews",
  );
  expect(published).toEqual([
    {
      id: userId,
      input: {
        associations: {
          course: { coursePrefix: "COMP", courseNumber: "2000" },
        },
        markdown: "Useful labs.",
        attribution: "attributed",
      },
    },
  ]);
  expect(updateTag).toHaveBeenCalledWith("contributions");

  publicationError = new ReviewWriteError(
    "onboarding-required",
    "Complete onboarding",
  );
  expect(await redirectOf(() => publishReview(null, form()))).toContain(
    "/onboarding?r=%2Fcourses%2FCOMP%2F2000",
  );
  publicationError = undefined;
});

test("Review action returns duplicate-review without redirecting", async () => {
  const { publishReview } = await import("@/app/courses/review-actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000044";
  publicationError = new ReviewWriteError(
    "duplicate-review",
    "This User already has an active Review for this Review Basis set",
  );
  expect(await publishReview(null, form())).toEqual({
    error: "duplicate-review",
  });
  publicationError = undefined;
});

test("Review actions edit optimistically and withdraw through the authorizing contribution seam", async () => {
  const { editReview, withdrawReview } = await import(
    "@/app/courses/review-actions"
  );
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000044";
  publicationError = undefined;
  edited.length = 0;
  withdrawn.length = 0;
  updateTag.mockClear();
  const reviewId = "00000000-0000-4000-8000-000000000144";
  const expectedRevisionId = "00000000-0000-4000-8000-000000000244";
  const editForm = form("Edited text.");
  editForm.set("reviewId", reviewId);
  editForm.set("expectedRevisionId", expectedRevisionId);
  editForm.set("attribution", "identity-hidden");

  expect(await redirectOf(() => editReview(editForm))).toContain(
    "/courses/COMP/2000?review=published#reviews",
  );
  expect(edited).toEqual([
    {
      id: userId,
      reviewId,
      input: {
        expectedRevisionId,
        associations: {
          course: { coursePrefix: "COMP", courseNumber: "2000" },
        },
        markdown: "Edited text.",
        attribution: "identity-hidden",
      },
    },
  ]);

  const withdrawForm = new FormData();
  withdrawForm.set("course", "COMP|2000");
  withdrawForm.set("reviewId", reviewId);
  withdrawForm.set("expectedRevisionId", expectedRevisionId);
  expect(await redirectOf(() => withdrawReview(withdrawForm))).toContain(
    "/courses/COMP/2000?review=withdrawn#reviews",
  );
  expect(withdrawn).toEqual([{ id: userId, reviewId, expectedRevisionId }]);
  expect(updateTag).toHaveBeenCalledTimes(2);
  expect(updateTag).toHaveBeenCalledWith("contributions");
});

test("Review edit and withdrawal actions reject cross-origin, malformed, and wrong-owner writes", async () => {
  const { editReview, withdrawReview } = await import(
    "@/app/courses/review-actions"
  );
  userId = "00000000-0000-4000-8000-000000000044";
  const editForm = form("Edited text.");
  editForm.set("reviewId", "bad");
  editForm.set("expectedRevisionId", "00000000-0000-4000-8000-000000000244");
  editForm.set("attribution", "attributed");
  expect(await redirectOf(() => editReview(editForm))).toContain(
    "reviewError=invalid-review",
  );

  const withdrawForm = new FormData();
  withdrawForm.set("course", "COMP|2000");
  withdrawForm.set("reviewId", "00000000-0000-4000-8000-000000000144");
  withdrawForm.set(
    "expectedRevisionId",
    "00000000-0000-4000-8000-000000000244",
  );
  origin = "https://evil.example";
  expect(await redirectOf(() => withdrawReview(withdrawForm))).toContain(
    "reviewError=cross-origin",
  );

  origin = "https://rankings.example";
  publicationError = new ReviewWriteError(
    "wrong-owner",
    "Only the Review author can change it",
  );
  expect(await redirectOf(() => withdrawReview(withdrawForm))).toContain(
    "reviewError=wrong-owner",
  );
  publicationError = undefined;
});
