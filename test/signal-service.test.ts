import { expect, test } from "vitest";
import {
  createSignalService,
  EMOJI_CODES,
  type SignalRepository,
  type SignalTarget,
  SignalWriteError,
} from "@/lib/contributions/signals";

const USER_ID = "00000000-0000-4000-8000-000000000047";
const INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000001";
const REVIEW_ID = "00000000-0000-4000-8000-000000000010";

function fakeRepository() {
  const writes: unknown[] = [];
  const repository: SignalRepository = {
    async readSignals(_target, userId) {
      return {
        thumbs: { up: 4, down: 2 },
        emoji: {
          love: 3,
          laugh: 0,
          surprised: 0,
          confused: 1,
          sad: 0,
          angry: 0,
          fire: 2,
        },
        ...(userId
          ? { mine: { thumbs: "up" as const, emoji: ["love" as const] } }
          : {}),
      };
    },
    async setThumbs(userId, target, state) {
      writes.push({ type: "thumbs", userId, target, state });
    },
    async setEmoji(userId, target, code, selected) {
      writes.push({ type: "emoji", userId, target, code, selected });
    },
    async mergeInstructorSignals(retiredUuid, survivorUuid) {
      writes.push({ type: "merge", retiredUuid, survivorUuid });
    },
  };
  return { repository, writes };
}

function service(repository: SignalRepository) {
  return createSignalService(repository, {
    async resolveTarget(target) {
      if (target.type === "course")
        return target.coursePrefix === "COMP" && target.courseNumber === "2000"
          ? target
          : undefined;
      if (target.type === "instructor")
        return target.instructorUuid === INSTRUCTOR_UUID ? target : undefined;
      return target.reviewId === REVIEW_ID ? target : undefined;
    },
  });
}

test("signal mutations normalize eligible Course, Instructor, and Review targets and use desired states", async () => {
  const { repository, writes } = fakeRepository();
  const signals = service(repository);

  await signals.setThumbs(USER_ID, {
    target: { type: "course", coursePrefix: " comp ", courseNumber: " 2000 " },
    state: "up",
  });
  await signals.setThumbs(USER_ID, {
    target: {
      type: "instructor",
      instructorUuid: INSTRUCTOR_UUID.toUpperCase(),
    },
    state: "none",
  });
  await signals.setThumbs(USER_ID, {
    target: { type: "review", reviewId: REVIEW_ID.toUpperCase() },
    state: "down",
  });
  for (const code of EMOJI_CODES)
    await signals.setEmoji(USER_ID, {
      target: { type: "instructor", instructorUuid: INSTRUCTOR_UUID },
      code,
      selected: true,
    });

  expect(writes[0]).toEqual({
    type: "thumbs",
    userId: USER_ID,
    target: { type: "course", coursePrefix: "COMP", courseNumber: "2000" },
    state: "up",
  });
  expect(writes[1]).toEqual({
    type: "thumbs",
    userId: USER_ID,
    target: { type: "instructor", instructorUuid: INSTRUCTOR_UUID },
    state: "none",
  });
  expect(writes[2]).toEqual({
    type: "thumbs",
    userId: USER_ID,
    target: { type: "review", reviewId: REVIEW_ID },
    state: "down",
  });
  expect(
    writes.slice(3).map((write) => (write as { code: string }).code),
  ).toEqual([...EMOJI_CODES]);
});

test("signal reads expose aggregates publicly and only the requesting User's state when authenticated", async () => {
  const { repository } = fakeRepository();
  const signals = service(repository);
  const target: SignalTarget = {
    type: "course",
    coursePrefix: "COMP",
    courseNumber: "2000",
  };

  expect(await signals.readSignals(target)).not.toHaveProperty("mine");
  expect(await signals.readSignals(target, USER_ID)).toMatchObject({
    thumbs: { up: 4, down: 2 },
    mine: { thumbs: "up", emoji: ["love"] },
  });
});

test("signals reject malformed Users, ineligible entity kinds, unknown targets, and arbitrary states or Emoji", async () => {
  const { repository, writes } = fakeRepository();
  const signals = service(repository);
  const attempts: Array<() => Promise<unknown>> = [
    () =>
      signals.setThumbs("not-a-user", {
        target: { type: "course", coursePrefix: "COMP", courseNumber: "2000" },
        state: "up",
      }),
    () =>
      signals.setThumbs(USER_ID, {
        target: { type: "course", coursePrefix: "MATH", courseNumber: "1012" },
        state: "up",
      }),
    () =>
      signals.setThumbs(USER_ID, {
        target: { type: "review", reviewId: "not-a-review" },
        state: "up",
      }),
    ...(["course-offering", "class"] as const).map(
      (type) => () =>
        signals.setThumbs(USER_ID, {
          target: { type } as unknown as SignalTarget,
          state: "up",
        }),
    ),
    () =>
      signals.setThumbs(USER_ID, {
        target: { type: "course", coursePrefix: "COMP", courseNumber: "2000" },
        state: "sideways" as "up",
      }),
    () =>
      signals.setEmoji(USER_ID, {
        target: { type: "instructor", instructorUuid: INSTRUCTOR_UUID },
        code: "thumbs-up" as "love",
        selected: true,
      }),
    () =>
      signals.setEmoji(USER_ID, {
        target: { type: "instructor", instructorUuid: INSTRUCTOR_UUID },
        code: "love",
        selected: "yes" as unknown as boolean,
      }),
  ];

  for (const attempt of attempts)
    await expect(attempt()).rejects.toBeInstanceOf(SignalWriteError);
  expect(writes).toEqual([]);
});

test("Instructor merge is explicit, rejects self-merges, and split requires no signal operation", async () => {
  const { repository, writes } = fakeRepository();
  const signals = service(repository);
  const retiredUuid = "00000000-0000-4000-8000-000000000002";

  await signals.mergeInstructorSignals(retiredUuid, INSTRUCTOR_UUID);
  await expect(
    signals.mergeInstructorSignals(INSTRUCTOR_UUID, INSTRUCTOR_UUID),
  ).rejects.toBeInstanceOf(SignalWriteError);

  expect(writes).toEqual([
    { type: "merge", retiredUuid, survivorUuid: INSTRUCTOR_UUID },
  ]);
});
