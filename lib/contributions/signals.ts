import { ContributionsUnavailableError } from "./reviews";

export const EMOJI_CODES = [
  "love",
  "laugh",
  "surprised",
  "confused",
  "sad",
  "angry",
  "fire",
] as const;

export type EmojiCode = (typeof EMOJI_CODES)[number];
export type ThumbsState = "up" | "down" | "none";
export type SignalTarget =
  | { type: "course"; coursePrefix: string; courseNumber: string }
  | { type: "instructor"; instructorUuid: string };

export type SignalSummary = {
  thumbs: { up: number; down: number };
  emoji: Record<EmojiCode, number>;
  mine?: { thumbs: ThumbsState; emoji: EmojiCode[] };
};

export interface SignalRepository {
  readSignals(target: SignalTarget, userId?: string): Promise<SignalSummary>;
  setThumbs(
    userId: string,
    target: SignalTarget,
    state: ThumbsState,
  ): Promise<void>;
  setEmoji(
    userId: string,
    target: SignalTarget,
    code: EmojiCode,
    selected: boolean,
  ): Promise<void>;
  mergeInstructorSignals(
    retiredUuid: string,
    survivorUuid: string,
  ): Promise<void>;
}

export type SignalWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "cross-origin"
  | "invalid-signal"
  | "invalid-target"
  | "rankings-unavailable";

export class SignalWriteError extends Error {
  constructor(
    public readonly code: SignalWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SignalWriteError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COURSE_PREFIX = /^[A-Z]{2,8}$/u;
const COURSE_NUMBER = /^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/u;

function userId(input: string) {
  if (typeof input !== "string" || !UUID.test(input))
    throw new SignalWriteError("account-not-found", "User was not found");
  return input.toLowerCase();
}

function target(input: SignalTarget): SignalTarget {
  if (!input || typeof input !== "object")
    throw new SignalWriteError("invalid-target", "Signal target is malformed");
  if (input.type === "course") {
    if (
      typeof input.coursePrefix !== "string" ||
      typeof input.courseNumber !== "string"
    )
      throw new SignalWriteError(
        "invalid-target",
        "Course target is malformed",
      );
    const coursePrefix = input.coursePrefix.trim().toUpperCase();
    const courseNumber = input.courseNumber.trim().toUpperCase();
    if (!COURSE_PREFIX.test(coursePrefix) || !COURSE_NUMBER.test(courseNumber))
      throw new SignalWriteError(
        "invalid-target",
        "Course target is malformed",
      );
    return { type: "course", coursePrefix, courseNumber };
  }
  if (
    input.type === "instructor" &&
    typeof input.instructorUuid === "string" &&
    UUID.test(input.instructorUuid)
  )
    return {
      type: "instructor",
      instructorUuid: input.instructorUuid.toLowerCase(),
    };
  throw new SignalWriteError(
    "invalid-target",
    "Only Courses and Instructors accept signals",
  );
}

export function createSignalService(
  repository: SignalRepository,
  options: {
    resolveTarget(target: SignalTarget): Promise<SignalTarget | undefined>;
  },
) {
  async function writableTarget(input: SignalTarget) {
    const resolved = await options.resolveTarget(target(input));
    if (!resolved)
      throw new SignalWriteError(
        "invalid-target",
        "Signal target does not exist",
      );
    return target(resolved);
  }

  return {
    readSignals(input: SignalTarget, authenticatedUserId?: string) {
      return repository.readSignals(
        target(input),
        authenticatedUserId ? userId(authenticatedUserId) : undefined,
      );
    },

    async setThumbs(
      authenticatedUserId: string,
      input: { target: SignalTarget; state: ThumbsState },
    ) {
      if (!(["up", "down", "none"] as unknown[]).includes(input.state))
        throw new SignalWriteError(
          "invalid-signal",
          "Thumbs state must be up, down, or none",
        );
      await repository.setThumbs(
        userId(authenticatedUserId),
        await writableTarget(input.target),
        input.state,
      );
    },

    async setEmoji(
      authenticatedUserId: string,
      input: {
        target: SignalTarget;
        code: EmojiCode;
        selected: boolean;
      },
    ) {
      if (
        !EMOJI_CODES.includes(input.code) ||
        typeof input.selected !== "boolean"
      )
        throw new SignalWriteError("invalid-signal", "Emoji state is invalid");
      await repository.setEmoji(
        userId(authenticatedUserId),
        await writableTarget(input.target),
        input.code,
        input.selected,
      );
    },

    async mergeInstructorSignals(retiredUuid: string, survivorUuid: string) {
      const retired = target({
        type: "instructor",
        instructorUuid: retiredUuid,
      });
      const survivor = target({
        type: "instructor",
        instructorUuid: survivorUuid,
      });
      if (
        retired.type !== "instructor" ||
        survivor.type !== "instructor" ||
        retired.instructorUuid === survivor.instructorUuid
      )
        throw new SignalWriteError(
          "invalid-target",
          "Instructor merge requires two different UUIDs",
        );
      await repository.mergeInstructorSignals(
        retired.instructorUuid,
        survivor.instructorUuid,
      );
    },
  };
}

export type SignalService = ReturnType<typeof createSignalService>;
export { ContributionsUnavailableError };
