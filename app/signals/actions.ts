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
}

function targetPath(target?: SignalTarget) {
  if (target?.type === "course")
    return `/courses/${target.coursePrefix}/${target.courseNumber}`;
  if (target?.type === "instructor")
    return `/instructors/${target.instructorUuid}`;
  return "/rankings/courses";
}

async function authorize(path: string) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSameOriginWrite(requestHeaders.get("origin"), host))
    redirect(`${path}?signalError=cross-origin#signals`);
  const userId = await authenticatedUserId();
  if (!userId) redirect(`/sign-in?r=${encodeURIComponent(path)}`);
  return userId;
}

function handleWriteError(error: unknown, path: string): never {
  if (!(error instanceof SignalWriteError)) throw error;
  if (error.code === "onboarding-required")
    redirect(`/onboarding?r=${encodeURIComponent(path)}`);
  redirect(`${path}?signalError=${error.code}#signals`);
}

export async function setThumbsSignal(formData: FormData) {
  const target = parsedTarget(formData);
  const path = targetPath(target);
  const state = formData.get("state");
  if (!target || !["up", "down", "none"].includes(String(state)))
    redirect(`${path}?signalError=invalid-signal#signals`);
  const userId = await authorize(path);
  try {
    await getSignalService().setThumbs(userId, {
      target,
      state: state as ThumbsState,
    });
  } catch (error) {
    handleWriteError(error, path);
  }
  redirect(`${path}?signal=updated#signals`);
}

export async function setEmojiSignal(formData: FormData) {
  const target = parsedTarget(formData);
  const path = targetPath(target);
  const code = formData.get("code");
  const selected = formData.get("selected");
  if (
    !target ||
    typeof code !== "string" ||
    !EMOJI_CODES.includes(code as EmojiCode) ||
    (selected !== "true" && selected !== "false")
  )
    redirect(`${path}?signalError=invalid-signal#signals`);
  const userId = await authorize(path);
  try {
    await getSignalService().setEmoji(userId, {
      target,
      code: code as EmojiCode,
      selected: selected === "true",
    });
  } catch (error) {
    handleWriteError(error, path);
  }
  redirect(`${path}?signal=updated#signals`);
}
