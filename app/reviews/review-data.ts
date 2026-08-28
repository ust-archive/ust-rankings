import { unstable_cache } from "next/cache";
import { authenticatedUserId } from "@/lib/auth/user";
import {
  ContributionsUnavailableError,
  type PublicReview,
} from "@/lib/contributions/reviews";

type ReadReview = (
  reviewId: string,
  viewerUserId?: string,
) => Promise<PublicReview | undefined>;

const readReview: ReadReview = async (reviewId, viewerUserId) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService()
    .getReview(reviewId, viewerUserId);

const readCachedReview = unstable_cache(readReview, ["review"], {
  revalidate: 3600,
  tags: ["contributions"],
});

export async function loadReview(
  reviewId: string,
  read: ReadReview = readReview,
) {
  const viewerUserId = process.env.AUTH_SECRET
    ? await authenticatedUserId().catch(() => undefined)
    : undefined;
  try {
    return {
      review: await (read === readReview
        ? readCachedReview(reviewId, viewerUserId)
        : read(reviewId, viewerUserId)),
      unavailable: false as const,
    };
  } catch (error) {
    if (error instanceof ContributionsUnavailableError)
      return { review: undefined, unavailable: true as const };
    throw error;
  }
}
