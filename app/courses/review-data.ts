import {
  ContributionsUnavailableError,
  type PublicCourseReview,
} from "@/lib/contributions/reviews";

type ReadCourseReviews = (input: {
  coursePrefix: string;
  courseNumber: string;
}) => Promise<PublicCourseReview[]>;

const readCourseReviews: ReadCourseReviews = async (course) =>
  (await import("@/lib/contributions/postgres"))
    .getReviewService()
    .listCourseReviews(course);

export async function loadCourseReviews(
  coursePrefix: string,
  courseNumber: string,
  read: ReadCourseReviews = readCourseReviews,
) {
  try {
    return {
      reviews: await read({ coursePrefix, courseNumber }),
      unavailable: false as const,
    };
  } catch (error) {
    if (error instanceof ContributionsUnavailableError)
      return { reviews: [], unavailable: true as const };
    throw error;
  }
}
