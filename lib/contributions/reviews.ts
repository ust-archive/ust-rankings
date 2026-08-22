import {
  type ImageAttachment,
  MAX_REVISION_ATTACHMENTS,
  normalizeAttachmentDescription,
  normalizeAttachmentFilename,
} from "@/lib/attachments/attachments";
import type { SignalSummary } from "./signals";

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

export type ReviewAttribution = "attributed" | "identity-hidden";

export type ReviewAttachmentDraft = {
  id?: string;
  storedFileId: string;
  filename: string;
  description: string;
};

export type PublicReview = ReviewAssociations & {
  id: string;
  revisionId: string;
  markdown: string;
  attribution: ReviewAttribution;
  attributionCredit: string;
  capturedDisplayName?: string;
  license: "CC BY 4.0";
  publishedAt: Date;
  viewerCanEdit?: boolean;
  instructorAssociationStatus?: InstructorAssociationStatus;
  attachments?: ImageAttachment[];
  signals?: SignalSummary;
};

export type PublishReviewRecord = {
  userId: string;
  associations: ReviewAssociations;
  markdown: string;
  attribution: ReviewAttribution;
  policyVersion: string;
  attachments?: ReviewAttachmentDraft[];
};

export type EditReviewRecord = PublishReviewRecord & {
  reviewId: string;
  expectedRevisionId: string;
};

export type WithdrawReviewRecord = {
  userId: string;
  reviewId: string;
  expectedRevisionId: string;
};

export type ReviewListQuery =
  | ({ type: "course" } & CourseBasis & { termCode?: string; section?: string })
  | {
      type: "instructor";
      instructorUuids: string[];
      termCode?: string;
    };

export interface ReviewRepository {
  publishReview(input: PublishReviewRecord): Promise<PublicReview>;
  editReview(input: EditReviewRecord): Promise<PublicReview>;
  withdrawReview(input: WithdrawReviewRecord): Promise<void>;
  getReview(
    reviewId: string,
    viewerUserId?: string,
  ): Promise<PublicReview | undefined>;
  listReviews(
    query: ReviewListQuery,
    viewerUserId?: string,
  ): Promise<PublicReview[]>;
}

export type ReviewWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "cross-origin"
  | "duplicate-review"
  | "review-not-found"
  | "wrong-owner"
  | "stale-review"
  | "review-withdrawn"
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

function normalizeAttachments(input: ReviewAttachmentDraft[] | undefined) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input))
    throw new ReviewWriteError("invalid-review", "Attachments are malformed");
  if (input.length > MAX_REVISION_ATTACHMENTS)
    throw new ReviewWriteError(
      "invalid-review",
      "A Review Revision has at most four Attachments",
    );
  try {
    return input.map((attachment) => {
      if (attachment.id && !UUID.test(attachment.id))
        throw new ReviewWriteError(
          "invalid-review",
          "Attachments are malformed",
        );
      if (!UUID.test(attachment.storedFileId))
        throw new ReviewWriteError(
          "invalid-review",
          "Attachments are malformed",
        );
      return {
        ...(attachment.id ? { id: attachment.id.toLowerCase() } : {}),
        storedFileId: attachment.storedFileId.toLowerCase(),
        filename: normalizeAttachmentFilename(attachment.filename),
        description: normalizeAttachmentDescription(attachment.description),
      };
    });
  } catch (error) {
    if (error instanceof ReviewWriteError) throw error;
    throw new ReviewWriteError("invalid-review", "Attachments are malformed");
  }
}

function normalizeRevisionInput(input: {
  associations: ReviewAssociations;
  markdown: string;
  attribution?: ReviewAttribution;
  attachments?: ReviewAttachmentDraft[];
}) {
  const associations = normalizeAssociations(input.associations);
  if (typeof input.markdown !== "string" || !input.markdown.trim())
    throw new ReviewWriteError(
      "invalid-review",
      "Review Markdown must not be empty",
    );
  const attribution = input.attribution ?? "attributed";
  if (attribution !== "attributed" && attribution !== "identity-hidden")
    throw new ReviewWriteError(
      "invalid-review",
      "Review attribution is malformed",
    );
  return {
    associations,
    markdown: input.markdown,
    attribution,
    attachments: normalizeAttachments(input.attachments),
  };
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
      input: {
        associations: ReviewAssociations;
        markdown: string;
        attribution?: ReviewAttribution;
        attachments?: ReviewAttachmentDraft[];
      },
    ) {
      if (!UUID.test(userId))
        throw new ReviewWriteError("account-not-found", "User was not found");
      const normalized = normalizeRevisionInput(input);
      const validated = await options.validateAssociations(
        normalized.associations,
      );
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
        markdown: normalized.markdown,
        attribution: normalized.attribution,
        policyVersion: options.reviewPolicyVersion,
        attachments: normalized.attachments,
      });
    },

    async editReview(
      userId: string,
      reviewId: string,
      input: {
        expectedRevisionId: string;
        associations: ReviewAssociations;
        markdown: string;
        attribution: ReviewAttribution;
        attachments?: ReviewAttachmentDraft[];
      },
    ) {
      if (!UUID.test(userId))
        throw new ReviewWriteError("account-not-found", "User was not found");
      if (!UUID.test(reviewId) || !UUID.test(input.expectedRevisionId))
        throw new ReviewWriteError(
          "invalid-review",
          "Review or expected Review Revision is malformed",
        );
      const normalized = normalizeRevisionInput(input);
      const validated = await options.validateAssociations(
        normalized.associations,
      );
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
      return repository.editReview({
        userId,
        reviewId,
        expectedRevisionId: input.expectedRevisionId,
        associations: validated,
        markdown: normalized.markdown,
        attribution: normalized.attribution,
        policyVersion: options.reviewPolicyVersion,
        attachments: normalized.attachments,
      });
    },

    async withdrawReview(
      userId: string,
      reviewId: string,
      expectedRevisionId: string,
    ) {
      if (!UUID.test(userId))
        throw new ReviewWriteError("account-not-found", "User was not found");
      if (!UUID.test(reviewId) || !UUID.test(expectedRevisionId))
        throw new ReviewWriteError(
          "invalid-review",
          "Review or expected Review Revision is malformed",
        );
      await repository.withdrawReview({
        userId,
        reviewId,
        expectedRevisionId,
      });
    },

    async getReview(reviewId: string, viewerUserId?: string) {
      if (!UUID.test(reviewId))
        throw new ReviewWriteError("review-not-found", "Review was not found");
      const review = await repository.getReview(
        reviewId,
        viewerUserId && UUID.test(viewerUserId) ? viewerUserId : undefined,
      );
      if (
        !review?.instructorUuid ||
        !options.resolveInstructorAssociationStatus
      )
        return review;
      const status = await options.resolveInstructorAssociationStatus(review);
      return status
        ? { ...review, instructorAssociationStatus: status }
        : review;
    },

    async listReviews(query: ReviewListQuery, viewerUserId?: string) {
      const instructorUuids =
        query.type === "instructor" && Array.isArray(query.instructorUuids)
          ? [
              ...new Set(
                query.instructorUuids.map(
                  (instructorUuid) =>
                    normalizeAssociations({ instructorUuid }).instructorUuid,
                ),
              ),
            ]
          : undefined;
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
              instructorUuid: instructorUuids?.[0],
              termCode: query.termCode,
            },
      );
      let reviews: PublicReview[];
      if (query.type === "course" && context.course)
        reviews = await repository.listReviews(
          {
            type: "course",
            ...context.course,
            termCode: context.termCode,
            section: context.section,
          },
          viewerUserId && UUID.test(viewerUserId) ? viewerUserId : undefined,
        );
      else if (
        query.type === "instructor" &&
        context.instructorUuid &&
        instructorUuids?.every((instructorUuid): instructorUuid is string =>
          Boolean(instructorUuid),
        )
      )
        reviews = await repository.listReviews(
          {
            type: "instructor",
            instructorUuids,
            termCode: context.termCode,
          },
          viewerUserId && UUID.test(viewerUserId) ? viewerUserId : undefined,
        );
      else
        throw new ReviewWriteError(
          "invalid-basis",
          "Review Basis is malformed",
        );
      const uniqueReviews = [
        ...new Map(reviews.map((review) => [review.id, review])).values(),
      ];
      if (!options.resolveInstructorAssociationStatus) return uniqueReviews;
      return Promise.all(
        uniqueReviews.map(async (review) => {
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
