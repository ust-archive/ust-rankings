"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatedUserId } from "@/lib/auth/user";
import { isSameOriginWrite } from "@/lib/contributions/http";
import { getSignalService } from "@/lib/contributions/postgres";
import {
  EMOJI_CODES,
  type EmojiCode,
  type SignalTarget,
  SignalWriteError,
  type ThumbsState,
} from "@/lib/contributions/signals";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COURSE_PREFIX = /^[A-Z]{2,8}$/u;
const COURSE_NUMBER = /^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/u;

function parsedTarget(formData: FormData): SignalTarget | undefined {
  if (formData.get("targetType") === "course") {
    const prefix = formData.get("coursePrefix");
    const number = formData.get("courseNumber");
    if (typeof prefix !== "string" || typeof number !== "string") return;
    const coursePrefix = prefix.trim().toUpperCase();
    const courseNumber = number.trim().toUpperCase();
    if (!COURSE_PREFIX.test(coursePrefix) || !COURSE_NUMBER.test(courseNumber))
      return;
    return { type: "course", coursePrefix, courseNumber };
  }
  if (formData.get("targetType") === "instructor") {
    const uuid = formData.get("instructorUuid");
    if (typeof uuid !== "string" || !UUID.test(uuid)) return;
    return { type: "instructor", instructorUuid: uuid.toLowerCase() };
  }
  if (formData.get("targetType") === "review") {
    const reviewId = formData.get("reviewId");
    if (typeof reviewId !== "string" || !UUID.test(reviewId)) return;
    return { type: "review", reviewId: reviewId.toLowerCase() };
  }
}

function targetPath(target?: SignalTarget) {
  if (target?.type === "course")
    return `/courses/${target.coursePrefix}/${target.courseNumber}`;
  if (target?.type === "instructor")
    return `/instructors/${target.instructorUuid}`;
  if (target?.type === "review") return `/reviews/${target.reviewId}`;
  return "/rankings/courses";
}

function anchor(target?: SignalTarget) {
  return target?.type === "review" ? `review-${target.reviewId}` : "signals";
}

function originatingPath(
  target: SignalTarget | undefined,
  referer: string | null,
  origin: string | null,
) {
  if (target?.type !== "review" || !referer || !origin)
    return targetPath(target);
  try {
    const url = new URL(referer);
    if (url.origin !== new URL(origin).origin || url.username || url.password)
      return targetPath(target);
    url.searchParams.delete("signal");
    url.searchParams.delete("signalError");
    return `${url.pathname}${url.search}`;
  } catch {
    return targetPath(target);
  }
}

function destination(
  path: string,
  target: SignalTarget | undefined,
  result?: { type: "signal" | "signalError"; value: string },
) {
  const url = new URL(path, "https://local.invalid");
  if (result) {
    url.searchParams.delete(
      result.type === "signal" ? "signalError" : "signal",
    );
    url.searchParams.set(result.type, result.value);
  }
  return `${url.pathname}${url.search}#${anchor(target)}`;
}

async function requestContext(target?: SignalTarget) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return {
    host,
    origin: requestHeaders.get("origin"),
    path: originatingPath(
      target,
      requestHeaders.get("referer"),
      requestHeaders.get("origin"),
    ),
  };
}

async function authorize(target: SignalTarget) {
  const context = await requestContext(target);
  if (!isSameOriginWrite(context.origin, context.host))
    redirect(
      destination(context.path, target, {
        type: "signalError",
        value: "cross-origin",
      }),
    );
  const userId = await authenticatedUserId();
  if (!userId)
    redirect(
      `/sign-in?r=${encodeURIComponent(
        target.type === "review"
          ? destination(context.path, target)
          : context.path,
      )}`,
    );
  return { path: context.path, userId };
}

function handleWriteError(
  error: unknown,
  path: string,
  target: SignalTarget,
): never {
  if (!(error instanceof SignalWriteError)) throw error;
  if (error.code === "onboarding-required")
    redirect(
      `/onboarding?r=${encodeURIComponent(
        target.type === "review" ? destination(path, target) : path,
      )}`,
    );
  redirect(
    destination(path, target, { type: "signalError", value: error.code }),
  );
}

export async function setThumbsSignal(formData: FormData) {
  const target = parsedTarget(formData);
  const state = formData.get("state");
  if (!target || !["up", "down", "none"].includes(String(state))) {
    const context = await requestContext(target);
    redirect(
      destination(context.path, target, {
        type: "signalError",
        value: "invalid-signal",
      }),
    );
  }
  const { path, userId } = await authorize(target);
  try {
    await getSignalService().setThumbs(userId, {
      target,
      state: state as ThumbsState,
    });
  } catch (error) {
    handleWriteError(error, path, target);
  }
  redirect(destination(path, target, { type: "signal", value: "updated" }));
}

export async function setEmojiSignal(formData: FormData) {
  const target = parsedTarget(formData);
  const code = formData.get("code");
  const selected = formData.get("selected");
  if (
    !target ||
    typeof code !== "string" ||
    !EMOJI_CODES.includes(code as EmojiCode) ||
    (selected !== "true" && selected !== "false")
  ) {
    const context = await requestContext(target);
    redirect(
      destination(context.path, target, {
        type: "signalError",
        value: "invalid-signal",
      }),
    );
  }
  const { path, userId } = await authorize(target);
  try {
    await getSignalService().setEmoji(userId, {
      target,
      code: code as EmojiCode,
      selected: selected === "true",
    });
  } catch (error) {
    handleWriteError(error, path, target);
  }
  redirect(destination(path, target, { type: "signal", value: "updated" }));
}
