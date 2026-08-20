export type CourseBasis = {
  coursePrefix: string;
  courseNumber: string;
};

export type ReviewAssociations = {
  course?: CourseBasis;
  instructorUuid?: string;
  termCode?: string;
  section?: string;
};

export type InstructorAssociationStatus =
  | "resolved"
  | "historical"
  | "needs-resolution";

export type PublicReview = ReviewAssociations & {
  id: string;
  revisionId: string;
  markdown: string;
  capturedDisplayName: string;
  publishedAt: Date;
  instructorAssociationStatus?: InstructorAssociationStatus;
};

export type PublishReviewRecord = {
  userId: string;
  associations: ReviewAssociations;
  markdown: string;
  policyVersion: string;
};

export type ReviewListQuery =
  | ({ type: "course" } & CourseBasis & { termCode?: string; section?: string })
  | {
      type: "instructor";
      instructorUuid: string;
      termCode?: string;
      section?: string;
    };

export interface ReviewRepository {
  publishReview(input: PublishReviewRecord): Promise<PublicReview>;
  listReviews(query: ReviewListQuery): Promise<PublicReview[]>;
}

export type ReviewWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "cross-origin"
  | "duplicate-review"
  | "invalid-basis"
  | "invalid-context"
  | "invalid-association"
  | "invalid-review"
  | "policy-unavailable"
  | "rankings-unavailable"
  | "schedule-unavailable";

export class ReviewWriteError extends Error {
  constructor(
    public readonly code: ReviewWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewWriteError";
  }
}

export class ContributionsUnavailableError extends Error {
  constructor(
    message = "Community contributions are unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContributionsUnavailableError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COURSE_PREFIX = /^[A-Z]{2,8}$/u;
const COURSE_NUMBER = /^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/u;
const TERM_CODE = /^[0-9]{4}$/u;
const SECTION = /^[A-Z][A-Z0-9-]{0,15}$/u;

function normalizeAssociations(input: ReviewAssociations): ReviewAssociations {
  if (!input || typeof input !== "object")
    throw new ReviewWriteError("invalid-basis", "Review Basis is malformed");
  let course: CourseBasis | undefined;
  if (input.course !== undefined) {
    if (
      !input.course ||
      typeof input.course.coursePrefix !== "string" ||
      typeof input.course.courseNumber !== "string"
    )
      throw new ReviewWriteError("invalid-basis", "Course Basis is malformed");
    course = {
      coursePrefix: input.course.coursePrefix.trim().toUpperCase(),
      courseNumber: input.course.courseNumber.trim().toUpperCase(),
    };
    if (
      !COURSE_PREFIX.test(course.coursePrefix) ||
      !COURSE_NUMBER.test(course.courseNumber)
    )
      throw new ReviewWriteError("invalid-basis", "Course Basis is malformed");
  }
  const instructorUuid =
    typeof input.instructorUuid === "string"
      ? input.instructorUuid.trim().toLowerCase()
      : undefined;
  if (input.instructorUuid !== undefined && !UUID.test(instructorUuid ?? ""))
    throw new ReviewWriteError(
      "invalid-basis",
      "Instructor Basis is malformed",
    );
  if (!course && !instructorUuid)
    throw new ReviewWriteError(
      "invalid-basis",
      "A Review requires at least one Review Basis",
    );

  const termCode =
    typeof input.termCode === "string" ? input.termCode.trim() : undefined;
  const section =
    typeof input.section === "string"
      ? input.section.trim().toUpperCase()
      : undefined;
  if (
    (input.termCode !== undefined && !TERM_CODE.test(termCode ?? "")) ||
    (input.section !== undefined && !SECTION.test(section ?? ""))
  )
    throw new ReviewWriteError(
      "invalid-context",
      "Review Context is malformed",
    );
  if (section && (!course || !termCode))
    throw new ReviewWriteError(
      "invalid-context",
      "Section requires a Course Basis and Term",
    );
  return { course, instructorUuid, termCode, section };
}

export function createReviewService(
  repository: ReviewRepository,
  options: {
    reviewPolicyVersion?: string;
    validateAssociations(
      associations: ReviewAssociations,
    ): Promise<ReviewAssociations | undefined>;
    resolveInstructorAssociationStatus?(
      review: PublicReview,
    ): Promise<InstructorAssociationStatus | undefined>;
  },
) {
  return {
    async publishReview(
      userId: string,
      input: { associations: ReviewAssociations; markdown: string },
    ) {
      if (!UUID.test(userId))
        throw new ReviewWriteError("account-not-found", "User was not found");
      const associations = normalizeAssociations(input.associations);
      if (typeof input.markdown !== "string" || !input.markdown.trim())
        throw new ReviewWriteError(
          "invalid-review",
          "Review Markdown must not be empty",
        );
      const validated = await options.validateAssociations(associations);
      if (!validated)
        throw new ReviewWriteError(
          "invalid-association",
          "Review Bases and Review Context are not associated in source data",
        );
      if (!options.reviewPolicyVersion)
        throw new ReviewWriteError(
          "policy-unavailable",
          "Review publication terms are not configured",
        );
      return repository.publishReview({
        userId,
        associations: validated,
        markdown: input.markdown,
        policyVersion: options.reviewPolicyVersion,
      });
    },

    async listReviews(query: ReviewListQuery) {
      const context = normalizeAssociations(
        query.type === "course"
          ? {
              course: {
                coursePrefix: query.coursePrefix,
                courseNumber: query.courseNumber,
              },
              termCode: query.termCode,
              section: query.section,
            }
          : {
              instructorUuid: query.instructorUuid,
              termCode: query.termCode,
              section: query.section,
            },
      );
      let reviews: PublicReview[];
      if (query.type === "course" && context.course)
        reviews = await repository.listReviews({
          type: "course",
          ...context.course,
          termCode: context.termCode,
          section: context.section,
        });
      else if (query.type === "instructor" && context.instructorUuid)
        reviews = await repository.listReviews({
          type: "instructor",
          instructorUuid: context.instructorUuid,
          termCode: context.termCode,
          section: context.section,
        });
      else
        throw new ReviewWriteError(
          "invalid-basis",
          "Review Basis is malformed",
        );
      if (!options.resolveInstructorAssociationStatus) return reviews;
      return Promise.all(
        reviews.map(async (review) => {
          if (!review.instructorUuid) return review;
          const status =
            await options.resolveInstructorAssociationStatus?.(review);
          return status
            ? { ...review, instructorAssociationStatus: status }
            : review;
        }),
      );
    },
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
