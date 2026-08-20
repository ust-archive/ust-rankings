export type CourseBasis = {
  coursePrefix: string;
  courseNumber: string;
};

export type PublicCourseReview = CourseBasis & {
  id: string;
  revisionId: string;
  markdown: string;
  capturedDisplayName: string;
  publishedAt: Date;
};

export type PublishCourseReviewRecord = CourseBasis & {
  userId: string;
  markdown: string;
  policyVersion: string;
};

export interface CourseReviewRepository {
  publishCourseReview(
    input: PublishCourseReviewRecord,
  ): Promise<PublicCourseReview>;
  listCourseReviews(course: CourseBasis): Promise<PublicCourseReview[]>;
}

export type ReviewWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "cross-origin"
  | "duplicate-review"
  | "invalid-course"
  | "invalid-review"
  | "policy-unavailable"
  | "rankings-unavailable";

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

function courseBasis(input: CourseBasis) {
  const coursePrefix = input.coursePrefix.trim().toUpperCase();
  const courseNumber = input.courseNumber.trim().toUpperCase();
  if (!COURSE_PREFIX.test(coursePrefix) || !COURSE_NUMBER.test(courseNumber))
    throw new ReviewWriteError("invalid-course", "Course Basis is malformed");
  return { coursePrefix, courseNumber };
}

export function createReviewService(
  repository: CourseReviewRepository,
  options: {
    reviewPolicyVersion?: string;
    courseExists(course: CourseBasis): Promise<boolean>;
  },
) {
  return {
    async publishCourseReview(
      userId: string,
      input: CourseBasis & { markdown: string },
    ) {
      if (!UUID.test(userId))
        throw new ReviewWriteError("account-not-found", "User was not found");
      const course = courseBasis(input);
      if (!input.markdown.trim())
        throw new ReviewWriteError(
          "invalid-review",
          "Review Markdown must not be empty",
        );
      if (!(await options.courseExists(course)))
        throw new ReviewWriteError("invalid-course", "Course does not exist");
      if (!options.reviewPolicyVersion)
        throw new ReviewWriteError(
          "policy-unavailable",
          "Review publication terms are not configured",
        );
      return repository.publishCourseReview({
        userId,
        ...course,
        markdown: input.markdown,
        policyVersion: options.reviewPolicyVersion,
      });
    },

    listCourseReviews(input: CourseBasis) {
      return repository.listCourseReviews(courseBasis(input));
    },
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
