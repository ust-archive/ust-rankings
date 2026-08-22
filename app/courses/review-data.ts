import {
  ContributionsUnavailableError,
  type PublicReview,
  type ReviewListQuery,
} from "@/lib/contributions/reviews";

type ReadReviews = (
  query: ReviewListQuery,
  viewerUserId?: string,
) => Promise<PublicReview[]>;

const readReviews: ReadReviews = async (query, viewerUserId) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService()
    .listReviews(query, viewerUserId);

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
    return {
      reviews: await read(query, viewerUserId),
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
) {
  return loadReviews({ type: "course", coursePrefix, courseNumber }, read);
}
