import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicReview } from "@/lib/contributions/reviews";

mock.module("server-only", () => ({}));

const REVIEW_ID = "00000000-0000-4000-8000-000000000146";
const current = (associations: Partial<PublicReview> = {}): PublicReview => ({
  id: REVIEW_ID,
  revisionId: crypto.randomUUID(),
  course: { coursePrefix: "COMP", courseNumber: "2000" },
  markdown: "Current public Review Revision.",
  attribution: "identity-hidden",
  attributionCredit: "UST Rankings contributor",
  license: "CC BY 4.0",
  publishedAt: new Date("2026-08-20T13:00:00.000Z"),
  ...associations,
});

test("stable Review permalink renders the current Revision across reassociation", async () => {
  const { dynamic, renderReviewPage } = await import(
    "@/app/reviews/[reviewId]/page"
  );
  const seen: string[] = [];
  let review = current();
  const read = async (reviewId: string) => {
    seen.push(reviewId);
    return { review, unavailable: false as const };
  };

  const before = renderToStaticMarkup(
    await renderReviewPage(
      { params: Promise.resolve({ reviewId: REVIEW_ID.toUpperCase() }) },
      read,
    ),
  );
  review = current({
    course: undefined,
    instructorUuid: "00000000-0000-4000-8000-000000000045",
  });
  const after = renderToStaticMarkup(
    await renderReviewPage(
      { params: Promise.resolve({ reviewId: REVIEW_ID }) },
      read,
    ),
  );

  expect(dynamic).toBe("force-dynamic");
  expect(seen).toEqual([REVIEW_ID, REVIEW_ID]);
  expect(before).toContain("Course Basis · COMP 2000");
  expect(after).toContain("Instructor Basis");
  expect(before).toContain(`href="/reviews/${REVIEW_ID}"`);
  expect(after).toContain(`href="/reviews/${REVIEW_ID}"`);
  expect(before.match(/Current public Review Revision/g)).toHaveLength(1);
  expect(after.match(/Current public Review Revision/g)).toHaveLength(1);
});

test("withdrawn or unknown Review permalink discloses no Revision", async () => {
  const { renderReviewPage } = await import("@/app/reviews/[reviewId]/page");
  for (const reviewId of [REVIEW_ID, "invalid"]) {
    try {
      await renderReviewPage(
        { params: Promise.resolve({ reviewId }) },
        async () => ({ review: undefined, unavailable: false as const }),
      );
      throw new Error("Missing Review did not return 404");
    } catch (error) {
      expect(String((error as { digest?: string }).digest)).toContain(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    }
  }
});

test("Review permalink distinguishes contribution failure from withdrawal", async () => {
  const { renderReviewPage } = await import("@/app/reviews/[reviewId]/page");
  const markup = renderToStaticMarkup(
    await renderReviewPage(
      { params: Promise.resolve({ reviewId: REVIEW_ID }) },
      async () => ({ review: undefined, unavailable: true as const }),
    ),
  );

  expect(markup).toContain("Review unavailable");
  expect(markup).toContain(
    "Rankings and Details remain independently available",
  );
  expect(markup).not.toContain("Current public Review Revision");
});
