export const REPORT_REASON_CATEGORIES = [
  "third-party-personal-data",
  "doxxing",
  "threats",
  "harassment",
  "slurs",
  "discriminatory-abuse",
  "impersonation",
  "spam",
  "deceptive-links",
  "confidential-materials",
  "unsupported-allegations",
  "personal-attacks",
  "malicious-files",
  "high-risk-data",
] as const;

export const REPORT_REASON_LABELS: Record<ReportReasonCategory, string> = {
  "third-party-personal-data": "Third-party personal data",
  doxxing: "Doxxing",
  threats: "Threats",
  harassment: "Harassment",
  slurs: "Slurs",
  "discriminatory-abuse": "Discriminatory abuse",
  impersonation: "Impersonation",
  spam: "Spam, advertising, or manipulation",
  "deceptive-links": "Deceptive links",
  "confidential-materials": "Confidential or unlawfully shared materials",
  "unsupported-allegations":
    "Unsupported crime or serious-misconduct allegations",
  "personal-attacks": "Irrelevant personal attacks",
  "malicious-files": "Malicious files",
  "high-risk-data": "Credentials, identifiers, or other high-risk data",
};

export const IDENTITY_LOOKUP_REASONS = [
  "report",
  "security-incident",
  "rights-request",
  "legal-request",
] as const;

export type ReportReasonCategory = (typeof REPORT_REASON_CATEGORIES)[number];
export type IdentityLookupReason = (typeof IDENTITY_LOOKUP_REASONS)[number];

export type ModerationAction =
  | "report"
  | "withdraw-review"
  | "suppress-attribution"
  | "remove-stored-file"
  | "suspend-user"
  | "identity-lookup";

export type ModerationTargetType = "review" | "stored-file" | "user";

export type ModerationCase = {
  id: string;
  createdAt: Date;
  targetType: ModerationTargetType;
  targetId: string;
  reasonCategory: string;
  action: ModerationAction;
  outcome: string;
  operatorIdentifier?: string;
  identityLookupReason?: IdentityLookupReason;
};

export type IdentityLookup = {
  userId: string;
  case: ModerationCase;
};

export interface ModerationRepository {
  reportReview(input: {
    userId: string;
    reviewId: string;
    reasonCategory: ReportReasonCategory;
  }): Promise<ModerationCase>;
  withdrawReview(input: {
    operatorIdentifier: string;
    reviewId: string;
    reasonCategory: ReportReasonCategory;
  }): Promise<ModerationCase>;
  suppressAttribution(input: {
    operatorIdentifier: string;
    reviewId: string;
    reasonCategory: ReportReasonCategory;
  }): Promise<ModerationCase>;
  removeStoredFile(input: {
    operatorIdentifier: string;
    storedFileId: string;
    reasonCategory: ReportReasonCategory;
  }): Promise<ModerationCase>;
  suspendUser(input: {
    operatorIdentifier: string;
    userId: string;
    reasonCategory: ReportReasonCategory;
  }): Promise<ModerationCase>;
  lookupIdentity(input: {
    operatorIdentifier: string;
    reviewId: string;
    reason: IdentityLookupReason;
  }): Promise<IdentityLookup>;
}

export type ModerationWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "review-not-found"
  | "review-withdrawn"
  | "stored-file-not-found"
  | "user-not-found"
  | "duplicate-report"
  | "invalid-reason"
  | "invalid-operator"
  | "unjustified-lookup"
  | "no-concrete-report";

export class ModerationWriteError extends Error {
  constructor(
    public readonly code: ModerationWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModerationWriteError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function asUuid(
  value: string,
  code: ModerationWriteErrorCode,
  message: string,
) {
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) throw new ModerationWriteError(code, message);
  return normalized;
}

function asReason(value: string): ReportReasonCategory {
  if ((REPORT_REASON_CATEGORIES as readonly string[]).includes(value))
    return value as ReportReasonCategory;
  throw new ModerationWriteError(
    "invalid-reason",
    "A concrete report reason is required",
  );
}

function asLookupReason(value: string): IdentityLookupReason {
  if ((IDENTITY_LOOKUP_REASONS as readonly string[]).includes(value))
    return value as IdentityLookupReason;
  throw new ModerationWriteError(
    "unjustified-lookup",
    "Identity lookup requires a concrete report, security incident, rights request, or legal request",
  );
}

function asOperator(value: string) {
  const operatorIdentifier = value.trim();
  if (!operatorIdentifier)
    throw new ModerationWriteError(
      "invalid-operator",
      "An operator identifier is required",
    );
  return operatorIdentifier;
}

export function createModerationService(repository: ModerationRepository) {
  return {
    async reportReview(
      userId: string,
      reviewId: string,
      reasonCategory: string,
    ) {
      return repository.reportReview({
        userId: asUuid(userId, "account-not-found", "User was not found"),
        reviewId: asUuid(reviewId, "review-not-found", "Review was not found"),
        reasonCategory: asReason(reasonCategory),
      });
    },

    async withdrawReview(
      operatorIdentifier: string,
      reviewId: string,
      reasonCategory: string,
    ) {
      return repository.withdrawReview({
        operatorIdentifier: asOperator(operatorIdentifier),
        reviewId: asUuid(reviewId, "review-not-found", "Review was not found"),
        reasonCategory: asReason(reasonCategory),
      });
    },

    async suppressAttribution(
      operatorIdentifier: string,
      reviewId: string,
      reasonCategory: string,
    ) {
      return repository.suppressAttribution({
        operatorIdentifier: asOperator(operatorIdentifier),
        reviewId: asUuid(reviewId, "review-not-found", "Review was not found"),
        reasonCategory: asReason(reasonCategory),
      });
    },

    async removeStoredFile(
      operatorIdentifier: string,
      storedFileId: string,
      reasonCategory: string,
    ) {
      return repository.removeStoredFile({
        operatorIdentifier: asOperator(operatorIdentifier),
        storedFileId: asUuid(
          storedFileId,
          "stored-file-not-found",
          "Stored File was not found",
        ),
        reasonCategory: asReason(reasonCategory),
      });
    },

    async suspendUser(
      operatorIdentifier: string,
      userId: string,
      reasonCategory: string,
    ) {
      return repository.suspendUser({
        operatorIdentifier: asOperator(operatorIdentifier),
        userId: asUuid(userId, "user-not-found", "User was not found"),
        reasonCategory: asReason(reasonCategory),
      });
    },

    async lookupIdentity(
      operatorIdentifier: string,
      reviewId: string,
      reason: string,
    ) {
      return repository.lookupIdentity({
        operatorIdentifier: asOperator(operatorIdentifier),
        reviewId: asUuid(reviewId, "review-not-found", "Review was not found"),
        reason: asLookupReason(reason),
      });
    },
  };
}

export type ModerationService = ReturnType<typeof createModerationService>;
