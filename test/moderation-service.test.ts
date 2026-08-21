import { expect, test } from "vitest";
import {
  createModerationService,
  type ModerationCase,
  type ModerationRepository,
  ModerationWriteError,
} from "@/lib/contributions/moderation";

const USER_ID = "00000000-0000-4000-8000-000000000050";
const REVIEW_ID = "00000000-0000-4000-8000-000000000150";
const FILE_ID = "00000000-0000-4000-8000-000000000250";
const OPERATOR = "deploy-operator";

function caseRecord(
  action: ModerationCase["action"],
  extra: Partial<ModerationCase> = {},
): ModerationCase {
  return {
    id: "00000000-0000-4000-8000-000000000350",
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    targetType: extra.targetType ?? "review",
    targetId: extra.targetId ?? REVIEW_ID,
    reasonCategory: extra.reasonCategory ?? "harassment",
    action,
    outcome: extra.outcome ?? "recorded",
    ...extra,
  };
}

function fakeRepository() {
  const calls: string[] = [];
  const repository: ModerationRepository = {
    async reportReview(input) {
      calls.push(
        `report:${input.userId}:${input.reviewId}:${input.reasonCategory}`,
      );
      return caseRecord("report");
    },
    async withdrawReview(input) {
      calls.push(
        `withdraw:${input.operatorIdentifier}:${input.reviewId}:${input.reasonCategory}`,
      );
      return caseRecord("withdraw-review", {
        operatorIdentifier: input.operatorIdentifier,
        outcome: "withdrawn",
      });
    },
    async suppressAttribution(input) {
      calls.push(
        `suppress:${input.operatorIdentifier}:${input.reviewId}:${input.reasonCategory}`,
      );
      return caseRecord("suppress-attribution", {
        operatorIdentifier: input.operatorIdentifier,
        outcome: "attribution-suppressed",
      });
    },
    async removeStoredFile(input) {
      calls.push(
        `remove:${input.operatorIdentifier}:${input.storedFileId}:${input.reasonCategory}`,
      );
      return caseRecord("remove-stored-file", {
        targetType: "stored-file",
        targetId: input.storedFileId,
        operatorIdentifier: input.operatorIdentifier,
        outcome: "removal-queued",
      });
    },
    async suspendUser(input) {
      calls.push(
        `suspend:${input.operatorIdentifier}:${input.userId}:${input.reasonCategory}`,
      );
      return caseRecord("suspend-user", {
        targetType: "user",
        targetId: input.userId,
        operatorIdentifier: input.operatorIdentifier,
        outcome: "suspended",
      });
    },
    async lookupIdentity(input) {
      calls.push(
        `lookup:${input.operatorIdentifier}:${input.reviewId}:${input.reason}`,
      );
      return {
        userId: USER_ID,
        case: caseRecord("identity-lookup", {
          operatorIdentifier: input.operatorIdentifier,
          reasonCategory: input.reason,
          identityLookupReason: input.reason,
          outcome: "inspected",
        }),
      };
    },
  };
  return {
    calls,
    moderation: createModerationService(repository),
  };
}

test("an active User reports a Review with a concrete reason and the case omits reporter identity", async () => {
  const { moderation, calls } = fakeRepository();
  const recorded = await moderation.reportReview(
    USER_ID,
    REVIEW_ID,
    "harassment",
  );
  expect(calls).toEqual([`report:${USER_ID}:${REVIEW_ID}:harassment`]);
  expect(recorded).toMatchObject({
    targetType: "review",
    targetId: REVIEW_ID,
    reasonCategory: "harassment",
    action: "report",
  });
  expect(recorded).not.toHaveProperty("reporterUserId");
  expect(recorded).not.toHaveProperty("reporter");
  expect(Object.keys(recorded).sort()).toEqual([
    "action",
    "createdAt",
    "id",
    "outcome",
    "reasonCategory",
    "targetId",
    "targetType",
  ]);
});

test("invalid reports are rejected before the repository is used", async () => {
  const { moderation, calls } = fakeRepository();
  await expect(
    moderation.reportReview("not-a-user", REVIEW_ID, "harassment"),
  ).rejects.toMatchObject({ code: "account-not-found" });
  await expect(
    moderation.reportReview(USER_ID, "not-a-review", "harassment"),
  ).rejects.toMatchObject({ code: "review-not-found" });
  await expect(
    moderation.reportReview(USER_ID, REVIEW_ID, "not-a-reason"),
  ).rejects.toMatchObject({ code: "invalid-reason" });
  expect(calls).toEqual([]);
});

test("each operator action records a minimal Moderation Case", async () => {
  const { moderation } = fakeRepository();
  const withdrawn = await moderation.withdrawReview(
    OPERATOR,
    REVIEW_ID,
    "threats",
  );
  const suppressed = await moderation.suppressAttribution(
    OPERATOR,
    REVIEW_ID,
    "slurs",
  );
  const removed = await moderation.removeStoredFile(
    OPERATOR,
    FILE_ID,
    "malicious-files",
  );
  const suspended = await moderation.suspendUser(
    OPERATOR,
    USER_ID,
    "harassment",
  );
  expect(withdrawn).toMatchObject({
    action: "withdraw-review",
    operatorIdentifier: OPERATOR,
    outcome: "withdrawn",
  });
  expect(suppressed).toMatchObject({
    action: "suppress-attribution",
    operatorIdentifier: OPERATOR,
  });
  expect(removed).toMatchObject({
    action: "remove-stored-file",
    targetType: "stored-file",
    targetId: FILE_ID,
  });
  expect(suspended).toMatchObject({
    action: "suspend-user",
    targetType: "user",
    targetId: USER_ID,
  });
  for (const recorded of [withdrawn, suppressed, removed, suspended]) {
    expect(recorded).not.toHaveProperty("reporterUserId");
    expect(recorded).not.toHaveProperty("ip");
    expect(recorded).not.toHaveProperty("activity");
  }
});

test("identity lookup requires a justified reason and is not casual browsing", async () => {
  const { moderation, calls } = fakeRepository();
  await expect(
    moderation.lookupIdentity(OPERATOR, REVIEW_ID, "curiosity"),
  ).rejects.toBeInstanceOf(ModerationWriteError);
  await expect(
    moderation.lookupIdentity(OPERATOR, REVIEW_ID, "curiosity"),
  ).rejects.toMatchObject({ code: "unjustified-lookup" });
  await expect(
    moderation.lookupIdentity("  ", REVIEW_ID, "report"),
  ).rejects.toMatchObject({ code: "invalid-operator" });
  expect(calls).toEqual([]);

  const lookedUp = await moderation.lookupIdentity(
    OPERATOR,
    REVIEW_ID,
    "rights-request",
  );
  expect(lookedUp.userId).toBe(USER_ID);
  expect(lookedUp.case).toMatchObject({
    action: "identity-lookup",
    identityLookupReason: "rights-request",
    operatorIdentifier: OPERATOR,
  });
  expect(lookedUp.case).not.toHaveProperty("reporterUserId");
});
