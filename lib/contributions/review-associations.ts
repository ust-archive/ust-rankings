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
    const index = await currentServerIndex();
    if (index) return index.validateReviewAssociations(associations);
  } catch (error) {
    if (error instanceof ServerIndexUnavailableError)
      throw new ReviewWriteError(
        "rankings-unavailable",
        "Review Bases cannot be validated while the Server Index is unavailable",
      );
    throw error;
  }

  const {
    getInstructorIdentity,
    getRankings,
    InvalidRankingsQueryError,
    RankingsUnavailableError,
    UnknownRankingsEntityError,
  } = await import("@/lib/rankings/server");
  const { getSchedule, InvalidScheduleQueryError, ScheduleUnavailableError } =
    await import("@/lib/schedule/server");
  try {
    let canonicalInstructorUuid = associations.instructorUuid;
    if (canonicalInstructorUuid)
      canonicalInstructorUuid = (
        await getInstructorIdentity(canonicalInstructorUuid)
      ).instructor.uuid;

    const courseRankings = associations.course
      ? await getRankings({ type: "course", ...associations.course })
      : undefined;
    const instructorRankings =
      canonicalInstructorUuid && !associations.course
        ? await getRankings({
            type: "instructor",
            uuid: canonicalInstructorUuid,
          })
        : undefined;
    if (
      associations.termCode &&
      instructorRankings &&
      !instructorRankings.terms.some(
        (term) => term.termCode === associations.termCode,
      )
    )
      return undefined;
    if (
      courseRankings &&
      canonicalInstructorUuid &&
      !courseRankings.instructors.some(
        (item) =>
          item.instructor.uuid === canonicalInstructorUuid &&
          (!associations.termCode || item.termCode === associations.termCode),
      )
    )
      return undefined;

    if (associations.course && associations.termCode) {
      const schedule = await getSchedule(
        associations.section
          ? {
              type: "class",
              ...associations.course,
              termCode: associations.termCode,
              section: associations.section,
            }
          : {
              type: "course-offering",
              ...associations.course,
              termCode: associations.termCode,
            },
      );
      if (
        canonicalInstructorUuid &&
        schedule.type === "class" &&
        !schedule.meetings.some((meeting) =>
          meeting.instructors.some(
            (instructor) => instructor.uuid === canonicalInstructorUuid,
          ),
        )
      )
        return undefined;
    }
    return {
      ...associations,
      ...(canonicalInstructorUuid
        ? { instructorUuid: canonicalInstructorUuid }
        : {}),
    };
  } catch (error) {
    if (
      error instanceof UnknownRankingsEntityError ||
      error instanceof InvalidRankingsQueryError ||
      error instanceof InvalidScheduleQueryError
    )
      return undefined;
    if (error instanceof RankingsUnavailableError)
      throw new ReviewWriteError(
        "rankings-unavailable",
        "Review Bases cannot be validated while the Ranking Generation is unavailable",
      );
    if (error instanceof ScheduleUnavailableError)
      throw new ReviewWriteError(
        "schedule-unavailable",
        "Review Context cannot be validated while Schedule Data is unavailable",
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
    const index = await currentServerIndex();
    if (index) return index.reviewInstructorAssociationStatus(review);
  } catch (error) {
    if (error instanceof ServerIndexUnavailableError)
      return review.instructorAssociationStatus;
    throw error;
  }

  const {
    getInstructorIdentity,
    RankingsUnavailableError,
    UnknownRankingsEntityError,
  } = await import("@/lib/rankings/server");
  try {
    const identity = await getInstructorIdentity(review.instructorUuid);
    const courseCode = review.course
      ? `${review.course.coursePrefix} ${review.course.courseNumber}`
      : undefined;
    if (
      identity.identityHistory.associationCorrections.some(
        (correction) =>
          correction.correctionType === "split" &&
          correction.status === "needs-resolution" &&
          identity.instructor.uuid !== correction.targetUuid &&
          (!courseCode || correction.courseCode === courseCode) &&
          (!review.termCode ||
            !correction.termCode ||
            correction.termCode === review.termCode),
      )
    )
      return "needs-resolution";
    if (identity.instructor.uuid !== review.instructorUuid) return "historical";
    return review.instructorAssociationStatus;
  } catch (error) {
    if (error instanceof UnknownRankingsEntityError) return "needs-resolution";
    if (error instanceof RankingsUnavailableError)
      return review.instructorAssociationStatus;
    throw error;
  }
}
