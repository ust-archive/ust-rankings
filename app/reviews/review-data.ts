import {
  ContributionsUnavailableError,
  type PublicReview,
} from "@/lib/contributions/reviews";

type ReadReview = (reviewId: string) => Promise<PublicReview | undefined>;

const readReview: ReadReview = async (reviewId) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService()
    .getReview(reviewId);

export async function loadReview(
  reviewId: string,
  read: ReadReview = readReview,
) {
  try {
    return { review: await read(reviewId), unavailable: false as const };
  } catch (error) {
    if (error instanceof ContributionsUnavailableError)
      return { review: undefined, unavailable: true as const };
    throw error;
  }
}
