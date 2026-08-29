import { unstable_cache } from "next/cache";
import {
  ContributionsUnavailableError,
  normalizePublicReview,
  type PublicReview,
  type ReviewListQuery,
  type ReviewOrder,
  readWithReviewCache,
} from "@/lib/contributions/reviews";

type ReadReviews = (
  query: ReviewListQuery,
  viewerUserId?: string,
) => Promise<PublicReview[]>;

const readReviews: ReadReviews = async (query, viewerUserId) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService()
    .listReviews(query, viewerUserId);

const readCachedReviews = unstable_cache(readReviews, ["reviews"], {
  revalidate: 3600,
  tags: ["contributions"],
});

async function optionalAuthenticatedUserId() {
  if (!process.env.AUTH_SECRET) return undefined;
  try {
    return await (await import("@/lib/auth/user")).authenticatedUserId();
  } catch {
    return undefined;
  }
}

export async function loadReviews(
  query: ReviewListQuery,
  read: ReadReviews = readReviews,
  identify: () => Promise<string | undefined> = optionalAuthenticatedUserId,
) {
  const viewerUserId = await identify().catch(() => undefined);
  try {
    const reviews = await readWithReviewCache(
      read === readReviews,
      () => readCachedReviews(query, viewerUserId),
      () => read(query, viewerUserId),
    );
    return {
      reviews: reviews.map(normalizePublicReview),
      signedIn: Boolean(viewerUserId),
      unavailable: false as const,
    };
  } catch (error) {
    if (error instanceof ContributionsUnavailableError)
      return {
        reviews: [],
        signedIn: Boolean(viewerUserId),
        unavailable: true as const,
      };
    throw error;
  }
}

export function loadCourseReviews(
  coursePrefix: string,
  courseNumber: string,
  read?: ReadReviews,
  order?: ReviewOrder,
) {
  return loadReviews(
    { type: "course", coursePrefix, courseNumber, order },
    read,
  );
}
