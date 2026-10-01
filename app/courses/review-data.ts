import {
  ContributionsUnavailableError,
  normalizePublicReview,
  type PublicReview,
  type ReviewListQuery,
  type ReviewOrder,
} from "@/lib/contributions/reviews";
import { skipBotCommunityRead } from "@/lib/database-request-context";

function reviewCaller(query: ReviewListQuery) {
  return query.type === "instructor"
    ? "instructor"
    : query.section
      ? "course-section"
      : query.termCode
        ? "course-term"
        : "course";
}

type ReadReviews = (
  query: ReviewListQuery,
  viewerUserId?: string,
) => Promise<PublicReview[]>;

const readReviews: ReadReviews = async (query, viewerUserId) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService({
      caller: reviewCaller(query),
      authentication: viewerUserId ? "authenticated" : "anonymous",
    })
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
): Promise<{
  reviews: PublicReview[];
  signedIn: boolean;
  unavailable: boolean;
  botRestricted?: true;
}> {
  const viewerUserId = await identify().catch(() => undefined);
  if (
    await skipBotCommunityRead(
      reviewCaller(query),
      "reviews.listReviews",
      Boolean(viewerUserId),
    )
  )
    return {
      reviews: [],
      signedIn: false,
      unavailable: true,
      botRestricted: true,
    };
  try {
    // Operator moderation changes PostgreSQL outside the Next.js process.
    const reviews = await read(query, viewerUserId);
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
