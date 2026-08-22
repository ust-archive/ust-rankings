import { expect, test, vi } from "vitest";
import { ModerationWriteError } from "@/lib/contributions/moderation";

let origin: string | null = "https://rankings.example";
let userId: string | undefined;
let reportError: unknown;
const reported: unknown[] = [];

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
  getReviewService: () => ({
    async publishReview() {},
    async editReview() {},
    async withdrawReview() {},
  }),
  getModerationService: () => ({
    async reportReview(id: string, reviewId: string, reasonCategory: string) {
      if (reportError) throw reportError;
      reported.push({ id, reviewId, reasonCategory });
    },
  }),
}));

function form() {
  const data = new FormData();
  data.set("course", "COMP|2000");
  data.set("reviewId", "00000000-0000-4000-8000-000000000150");
  data.set("reasonCategory", "harassment");
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

test("Review reporting denies cross-origin and signed-out writes", async () => {
  const { reportReview } = await import("@/app/courses/review-actions");
  reported.length = 0;
  userId = "00000000-0000-4000-8000-000000000050";
  origin = "https://evil.example";
  expect(await redirectOf(() => reportReview(form()))).toContain(
    "/courses/COMP/2000?reviewError=cross-origin#reviews",
  );
  expect(reported).toHaveLength(0);

  origin = "https://rankings.example";
  userId = undefined;
  expect(await redirectOf(() => reportReview(form()))).toContain(
    "/auth/login?r=%2Fcourses%2FCOMP%2F2000",
  );
  expect(reported).toHaveLength(0);
});

test("authenticated reporting records a concrete reason and hides reporter identity", async () => {
  const { reportReview } = await import("@/app/courses/review-actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000050";
  reportError = undefined;
  reported.length = 0;
  expect(await redirectOf(() => reportReview(form()))).toContain(
    "/courses/COMP/2000?review=reported#reviews",
  );
  expect(reported).toEqual([
    {
      id: userId,
      reviewId: "00000000-0000-4000-8000-000000000150",
      reasonCategory: "harassment",
    },
  ]);
  expect(JSON.stringify(reported)).not.toContain("reporter");
});

test("invalid and duplicate reports fail closed", async () => {
  const { reportReview } = await import("@/app/courses/review-actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000050";
  reportError = undefined;
  const missingReason = form();
  missingReason.set("reasonCategory", "");
  expect(await redirectOf(() => reportReview(missingReason))).toContain(
    "reviewError=invalid-reason",
  );
  const missingTarget = form();
  missingTarget.set("reviewId", "bad");
  expect(await redirectOf(() => reportReview(missingTarget))).toContain(
    "reviewError=invalid-review",
  );
  reportError = new ModerationWriteError(
    "duplicate-report",
    "This User already reported this Review",
  );
  expect(await redirectOf(() => reportReview(form()))).toContain(
    "reviewError=duplicate-report",
  );
  reportError = undefined;
});
