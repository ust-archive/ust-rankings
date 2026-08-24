import type {
  InstructorAssociationStatus,
  PublicReview,
  ReviewAssociations,
} from "./reviews";
import { ReviewWriteError } from "./reviews";

export async function validateReviewAssociations(
  associations: ReviewAssociations,
): Promise<ReviewAssociations | undefined> {
  const { currentServerIndex, ServerIndexUnavailableError } = await import(
    "@/lib/server-index"
  );
  try {
    return (await currentServerIndex()).validateReviewAssociations(
      associations,
    );
  } catch (error) {
    if (error instanceof ServerIndexUnavailableError)
      throw new ReviewWriteError(
        "rankings-unavailable",
        "Review Bases cannot be validated while the Server Index is unavailable",
      );
    throw error;
  }
}

export async function resolveReviewInstructorAssociationStatus(
  review: PublicReview,
): Promise<InstructorAssociationStatus | undefined> {
  if (!review.instructorUuid) return undefined;
  const { currentServerIndex, ServerIndexUnavailableError } = await import(
    "@/lib/server-index"
  );
  try {
    return (await currentServerIndex()).reviewInstructorAssociationStatus(
      review,
    );
  } catch (error) {
    if (error instanceof ServerIndexUnavailableError)
      return review.instructorAssociationStatus;
    throw error;
  }
}
