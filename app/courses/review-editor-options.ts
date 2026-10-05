import type { PublicReview } from "@/lib/contributions/reviews";
import {
  currentServerIndex,
  ServerIndexUnavailableError,
} from "@/lib/server-index";
import type { ReviewEditorOptions } from "./course-reviews";

export async function hydrateReviewEditorOptions(
  editor: ReviewEditorOptions,
  reviews: PublicReview[],
): Promise<ReviewEditorOptions> {
  const editable = reviews.filter((review) => review.viewerCanEdit);
  if (!editable.length) return editor;
  let index: Awaited<ReturnType<typeof currentServerIndex>>;
  try {
    index = await currentServerIndex();
  } catch (error) {
    if (error instanceof ServerIndexUnavailableError) return editor;
    throw error;
  }
  const supported = editable.filter((review) => {
    const associations = index.validateReviewAssociations({
      course: review.course,
      instructorUuid: review.instructorUuid,
      termCode: review.termCode,
      section: review.section,
    });
    return (
      associations &&
      associations.instructorUuid === review.instructorUuid &&
      review.instructorAssociationStatus !== "needs-resolution"
    );
  });
  const names = index.instructorNamesForUuids(
    supported.flatMap((review) =>
      review.instructorUuid ? [review.instructorUuid] : [],
    ),
  );
  return {
    courses: [
      ...new Map(
        [
          ...editor.courses,
          ...supported.flatMap((review) =>
            review.course ? [review.course] : [],
          ),
        ].map((course) => [
          `${course.coursePrefix}|${course.courseNumber}`,
          course,
        ]),
      ).values(),
    ],
    instructors: [
      ...new Map(
        [
          ...editor.instructors,
          ...supported.flatMap((review) =>
            review.instructorUuid
              ? [
                  {
                    instructorUuid: review.instructorUuid,
                    name:
                      names.get(review.instructorUuid) ?? review.instructorUuid,
                  },
                ]
              : [],
          ),
        ].map((instructor) => [instructor.instructorUuid, instructor]),
      ).values(),
    ],
    contexts: [
      ...(editor.contexts ?? []),
      ...supported.flatMap((review) =>
        review.termCode
          ? [
              {
                course: review.course,
                instructorUuid: review.instructorUuid,
                termCode: review.termCode,
                section: review.section,
              },
            ]
          : [],
      ),
    ],
  };
}
