"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatedUserId } from "@/lib/auth/user";
import { courseReviewPath, isSameOriginWrite } from "@/lib/contributions/http";
import {
  ModerationWriteError,
  REPORT_REASON_CATEGORIES,
} from "@/lib/contributions/moderation";
import {
  getModerationService,
  getReviewService,
} from "@/lib/contributions/postgres";
import type {
  ReviewAssociations,
  ReviewAttachmentDraft,
  ReviewAttribution,
} from "@/lib/contributions/reviews";
import { ReviewWriteError } from "@/lib/contributions/reviews";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function stringEntry(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function parseAttachments(formData: FormData) {
  const raw = stringEntry(formData, "attachments");
  if (raw === undefined || raw === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return "invalid" as const;
    return parsed as ReviewAttachmentDraft[];
  } catch {
    return "invalid" as const;
  }
}

function parseReviewForm(formData: FormData) {
  const rawCourse = formData.get("course");
  const rawInstructor = formData.get("instructorUuid");
  const rawTermCode = formData.get("termCode");
  const rawSection = formData.get("section");
  const submittedCourse = stringEntry(formData, "course");
  const courseEntry =
    submittedCourse === "all-courses" ? undefined : submittedCourse;
  const courseParts = courseEntry?.split("|") ?? [];
  const [coursePrefix = "", courseNumber = ""] = courseParts;
  const submittedInstructor = stringEntry(formData, "instructorUuid");
  const instructorEntry =
    submittedInstructor === "all-instructors" ? undefined : submittedInstructor;
  const instructorUuid = instructorEntry?.trim().toLowerCase();
  const termCode = stringEntry(formData, "termCode")?.trim() || undefined;
  const section = stringEntry(formData, "section")?.trim() || undefined;
  const path = courseEntry
    ? courseReviewPath(coursePrefix, courseNumber)
    : instructorUuid && UUID.test(instructorUuid)
      ? `/instructors/${instructorUuid}`
      : "/rankings/courses";
  const invalidBasis =
    (rawCourse !== null && typeof rawCourse !== "string") ||
    (rawInstructor !== null && typeof rawInstructor !== "string") ||
    (courseEntry !== undefined && courseParts.length !== 2);
  const invalidContext =
    (rawTermCode !== null && typeof rawTermCode !== "string") ||
    (rawSection !== null && typeof rawSection !== "string");
  const associations: ReviewAssociations = {
    ...(courseEntry ? { course: { coursePrefix, courseNumber } } : {}),
    ...(instructorEntry !== undefined
      ? { instructorUuid: instructorEntry }
      : {}),
    ...(termCode ? { termCode } : {}),
    ...(section ? { section } : {}),
  };
  return { path, associations, invalidBasis, invalidContext };
}

async function authorizeWrite(path: string) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSameOriginWrite(requestHeaders.get("origin"), host))
    redirect(`${path}?reviewError=cross-origin#reviews`);
  const userId = await authenticatedUserId();
  if (!userId) redirect(`/sign-in?r=${encodeURIComponent(path)}`);
  return userId;
}

function redirectReviewError(error: unknown, path: string): never {
  if (
    !(error instanceof ReviewWriteError) &&
    !(error instanceof ModerationWriteError)
  )
    throw error;
  if (error.code === "onboarding-required")
    redirect(`/onboarding?r=${encodeURIComponent(path)}`);
  redirect(`${path}?reviewError=${error.code}#reviews`);
}

type ReviewPublishState = { error?: string } | null;

export async function publishReview(
  _prevState: ReviewPublishState,
  formData: FormData,
): Promise<ReviewPublishState> {
  const parsed = parseReviewForm(formData);
  const userId = await authorizeWrite(parsed.path);
  const markdown = stringEntry(formData, "markdown");
  const attribution = stringEntry(formData, "attribution") ?? "attributed";
  if (markdown === undefined)
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  if (parsed.invalidBasis)
    redirect(`${parsed.path}?reviewError=invalid-basis#reviews`);
  if (parsed.invalidContext)
    redirect(`${parsed.path}?reviewError=invalid-context#reviews`);
  if (attribution !== "attributed" && attribution !== "identity-hidden")
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  const attachments = parseAttachments(formData);
  if (attachments === "invalid")
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  try {
    await getReviewService().publishReview(userId, {
      associations: parsed.associations,
      markdown,
      attribution,
      attachments,
    });
  } catch (error) {
    if (error instanceof ReviewWriteError && error.code === "duplicate-review")
      return { error: error.code };
    redirectReviewError(error, parsed.path);
  }
  redirect(`${parsed.path}?review=published#reviews`);
}

export async function editReview(formData: FormData) {
  const parsed = parseReviewForm(formData);
  const userId = await authorizeWrite(parsed.path);
  const reviewId = stringEntry(formData, "reviewId");
  const expectedRevisionId = stringEntry(formData, "expectedRevisionId");
  const markdown = stringEntry(formData, "markdown");
  const attribution = stringEntry(formData, "attribution");
  if (
    !reviewId ||
    !UUID.test(reviewId) ||
    !expectedRevisionId ||
    !UUID.test(expectedRevisionId) ||
    markdown === undefined ||
    (attribution !== "attributed" && attribution !== "identity-hidden")
  )
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  if (parsed.invalidBasis)
    redirect(`${parsed.path}?reviewError=invalid-basis#reviews`);
  if (parsed.invalidContext)
    redirect(`${parsed.path}?reviewError=invalid-context#reviews`);
  const attachments = parseAttachments(formData);
  if (attachments === "invalid")
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  try {
    await getReviewService().editReview(userId, reviewId, {
      expectedRevisionId,
      associations: parsed.associations,
      markdown,
      attribution: attribution as ReviewAttribution,
      attachments,
    });
  } catch (error) {
    redirectReviewError(error, parsed.path);
  }
  redirect(`${parsed.path}?review=published#reviews`);
}

export async function withdrawReview(formData: FormData) {
  const parsed = parseReviewForm(formData);
  const userId = await authorizeWrite(parsed.path);
  const reviewId = stringEntry(formData, "reviewId");
  const expectedRevisionId = stringEntry(formData, "expectedRevisionId");
  if (
    !reviewId ||
    !UUID.test(reviewId) ||
    !expectedRevisionId ||
    !UUID.test(expectedRevisionId)
  )
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  try {
    await getReviewService().withdrawReview(
      userId,
      reviewId,
      expectedRevisionId,
    );
  } catch (error) {
    redirectReviewError(error, parsed.path);
  }
  redirect(`${parsed.path}?review=withdrawn#reviews`);
}

export async function reportReview(formData: FormData) {
  const parsed = parseReviewForm(formData);
  const userId = await authorizeWrite(parsed.path);
  const reviewId = stringEntry(formData, "reviewId");
  const reasonCategory = stringEntry(formData, "reasonCategory");
  if (!reviewId || !UUID.test(reviewId))
    redirect(`${parsed.path}?reviewError=invalid-review#reviews`);
  if (
    !reasonCategory ||
    !(REPORT_REASON_CATEGORIES as readonly string[]).includes(reasonCategory)
  )
    redirect(`${parsed.path}?reviewError=invalid-reason#reviews`);
  try {
    await getModerationService().reportReview(userId, reviewId, reasonCategory);
  } catch (error) {
    redirectReviewError(error, parsed.path);
  }
  redirect(`${parsed.path}?review=reported#reviews`);
}
