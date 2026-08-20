import { expect, mock, test } from "bun:test";
import { ReviewWriteError } from "@/lib/contributions/reviews";

let origin: string | null = "https://rankings.example";
let userId: string | undefined;
let publicationError: unknown;
const published: unknown[] = [];

mock.module("next/headers", () => ({
  headers: async () =>
    new Headers({
      host: "rankings.example",
      ...(origin ? { origin } : {}),
    }),
}));
mock.module("@/lib/auth/user", () => ({
  authenticatedUserId: async () => userId,
}));
mock.module("@/lib/contributions/postgres", () => ({
  getReviewService: () => ({
    async publishReview(id: string, input: unknown) {
      if (publicationError) throw publicationError;
      published.push({ id, input });
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
  expect(await redirectOf(() => publishReview(form()))).toContain(
    "/courses/COMP/2000?reviewError=cross-origin#reviews",
  );
  expect(published).toHaveLength(0);

  origin = "https://rankings.example";
  userId = undefined;
  expect(await redirectOf(() => publishReview(form()))).toContain(
    "/sign-in?r=%2Fcourses%2FCOMP%2F2000",
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
        form(
          new File(["not text input"], "review.txt", { type: "text/plain" }),
        ),
      ),
    ),
  ).toContain("/courses/COMP/2000?reviewError=invalid-review#reviews");
  expect(published).toHaveLength(0);

  const malformedCourse = form();
  malformedCourse.set("course", new File(["COMP|2000"], "course.txt"));
  expect(await redirectOf(() => publishReview(malformedCourse))).toContain(
    "/rankings/courses?reviewError=invalid-basis#reviews",
  );
  const malformedContext = form();
  malformedContext.set("termCode", new File(["2510"], "term.txt"));
  expect(await redirectOf(() => publishReview(malformedContext))).toContain(
    "/courses/COMP/2000?reviewError=invalid-context#reviews",
  );
  expect(published).toHaveLength(0);
});

test("Review action publishes for an authenticated User and routes onboarding failures", async () => {
  const { publishReview } = await import("@/app/courses/review-actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000044";
  publicationError = undefined;
  published.length = 0;
  expect(await redirectOf(() => publishReview(form()))).toContain(
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
      },
    },
  ]);

  publicationError = new ReviewWriteError(
    "onboarding-required",
    "Complete onboarding",
  );
  expect(await redirectOf(() => publishReview(form()))).toContain(
    "/onboarding?r=%2Fcourses%2FCOMP%2F2000",
  );
  publicationError = undefined;
});
