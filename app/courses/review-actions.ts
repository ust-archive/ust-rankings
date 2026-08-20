"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatedUserId } from "@/lib/auth/user";
import { courseReviewPath, isSameOriginWrite } from "@/lib/contributions/http";
import { getReviewService } from "@/lib/contributions/postgres";
import { ReviewWriteError } from "@/lib/contributions/reviews";

export async function publishCourseReview(formData: FormData) {
  const coursePrefix = String(formData.get("coursePrefix") ?? "");
  const courseNumber = String(formData.get("courseNumber") ?? "");
  const path = courseReviewPath(coursePrefix, courseNumber);
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSameOriginWrite(requestHeaders.get("origin"), host))
    redirect(`${path}?reviewError=cross-origin#reviews`);

  const userId = await authenticatedUserId();
  if (!userId) redirect(`/sign-in?r=${encodeURIComponent(path)}`);
  try {
    await getReviewService().publishCourseReview(userId, {
      coursePrefix,
      courseNumber,
      markdown: String(formData.get("markdown") ?? ""),
    });
  } catch (error) {
    if (!(error instanceof ReviewWriteError)) throw error;
    if (error.code === "onboarding-required")
      redirect(`/onboarding?r=${encodeURIComponent(path)}`);
    redirect(`${path}?reviewError=${error.code}#reviews`);
  }
  redirect(`${path}?review=published#reviews`);
}
