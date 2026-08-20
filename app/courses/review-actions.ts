"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatedUserId } from "@/lib/auth/user";
import { courseReviewPath, isSameOriginWrite } from "@/lib/contributions/http";
import { getReviewService } from "@/lib/contributions/postgres";
import type { ReviewAssociations } from "@/lib/contributions/reviews";
import { ReviewWriteError } from "@/lib/contributions/reviews";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function stringEntry(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function publishReview(formData: FormData) {
  const rawCourse = formData.get("course");
  const rawInstructor = formData.get("instructorUuid");
  const rawTermCode = formData.get("termCode");
  const rawSection = formData.get("section");
  const courseEntry = stringEntry(formData, "course");
  const courseParts = courseEntry?.split("|") ?? [];
  const [coursePrefix = "", courseNumber = ""] = courseParts;
  const instructorEntry = stringEntry(formData, "instructorUuid");
  const instructorUuid = instructorEntry?.trim().toLowerCase();
  const markdown = stringEntry(formData, "markdown");
  const termCode = stringEntry(formData, "termCode")?.trim() || undefined;
  const section = stringEntry(formData, "section")?.trim() || undefined;
  const path = courseEntry
    ? courseReviewPath(coursePrefix, courseNumber)
    : instructorUuid && UUID.test(instructorUuid)
      ? `/instructors/${instructorUuid}`
      : "/rankings/courses";
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSameOriginWrite(requestHeaders.get("origin"), host))
    redirect(`${path}?reviewError=cross-origin#reviews`);
  if (markdown === undefined)
    redirect(`${path}?reviewError=invalid-review#reviews`);
  if (
    (rawCourse !== null && typeof rawCourse !== "string") ||
    (rawInstructor !== null && typeof rawInstructor !== "string") ||
    (courseEntry !== undefined && courseParts.length !== 2)
  )
    redirect(`${path}?reviewError=invalid-basis#reviews`);
  if (
    (rawTermCode !== null && typeof rawTermCode !== "string") ||
    (rawSection !== null && typeof rawSection !== "string")
  )
    redirect(`${path}?reviewError=invalid-context#reviews`);

  const associations: ReviewAssociations = {
    ...(courseEntry ? { course: { coursePrefix, courseNumber } } : {}),
    ...(instructorEntry !== undefined
      ? { instructorUuid: instructorEntry }
      : {}),
    ...(termCode ? { termCode } : {}),
    ...(section ? { section } : {}),
  };
  const userId = await authenticatedUserId();
  if (!userId) redirect(`/sign-in?r=${encodeURIComponent(path)}`);
  try {
    await getReviewService().publishReview(userId, { associations, markdown });
  } catch (error) {
    if (!(error instanceof ReviewWriteError)) throw error;
    if (error.code === "onboarding-required")
      redirect(`/onboarding?r=${encodeURIComponent(path)}`);
    redirect(`${path}?reviewError=${error.code}#reviews`);
  }
  redirect(`${path}?review=published#reviews`);
}
