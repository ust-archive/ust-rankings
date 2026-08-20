import {
  ContributionsUnavailableError,
  type PublicReview,
  type ReviewListQuery,
} from "@/lib/contributions/reviews";

type ReadReviews = (query: ReviewListQuery) => Promise<PublicReview[]>;

const readReviews: ReadReviews = async (query) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService()
    .listReviews(query);

export async function loadReviews(
  query: ReviewListQuery,
  read: ReadReviews = readReviews,
) {
  try {
    return { reviews: await read(query), unavailable: false as const };
  } catch (error) {
    if (error instanceof ContributionsUnavailableError)
      return { reviews: [], unavailable: true as const };
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
