import { expect, test, vi } from "vitest";
import { SignalWriteError } from "@/lib/contributions/signals";

let origin: string | null = "https://rankings.example";
let referer: string | undefined;
let userId: string | undefined;
let mutationError: unknown;
const mutations: unknown[] = [];

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      host: "rankings.example",
      ...(origin ? { origin } : {}),
      ...(referer ? { referer } : {}),
    }),
}));
vi.mock("@/lib/auth/user", () => ({
  authenticatedUserId: async () => userId,
}));
vi.mock("@/lib/contributions/postgres", () => ({
  getSignalService: () => ({
    async setThumbs(id: string, input: unknown) {
      if (mutationError) throw mutationError;
      mutations.push({ type: "thumbs", id, input });
    },
    async setEmoji(id: string, input: unknown) {
      if (mutationError) throw mutationError;
      mutations.push({ type: "emoji", id, input });
    },
  }),
}));

function courseForm() {
  const form = new FormData();
  form.set("targetType", "course");
  form.set("coursePrefix", "COMP");
  form.set("courseNumber", "2000");
  return form;
}

function reviewForm() {
  const form = new FormData();
  form.set("targetType", "review");
  form.set("reviewId", "00000000-0000-4000-8000-000000000010");
  return form;
}

function instructorForm() {
  const form = new FormData();
  form.set("targetType", "instructor");
  form.set("instructorUuid", "00000000-0000-4000-8000-000000000001");
  return form;
}

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
    throw new Error("Mutation did not redirect");
  } catch (error) {
    return String((error as { digest?: string }).digest);
  }
}

test("signal actions require same-origin authentication and preserve the target return path", async () => {
  const { setThumbsSignal } = await import("@/app/signals/actions");
  mutations.length = 0;
  mutationError = undefined;
  userId = "00000000-0000-4000-8000-000000000047";
  const crossOrigin = courseForm();
  crossOrigin.set("state", "up");
  origin = "https://evil.example";
  expect(await redirectOf(() => setThumbsSignal(crossOrigin))).toContain(
    "/courses/COMP/2000?signalError=cross-origin#signals",
  );
  expect(mutations).toEqual([]);

  origin = "https://rankings.example";
  userId = undefined;
  const signedOut = instructorForm();
  signedOut.set("state", "down");
  expect(await redirectOf(() => setThumbsSignal(signedOut))).toContain(
    "/auth/login?r=%2Finstructors%2F00000000-0000-4000-8000-000000000001",
  );
  expect(mutations).toEqual([]);
});

test("signal actions send desired Thumbs and Emoji states and route onboarding", async () => {
  const { setEmojiSignal, setThumbsSignal } = await import(
    "@/app/signals/actions"
  );
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000047";
  mutationError = undefined;
  mutations.length = 0;

  const thumbs = courseForm();
  thumbs.set("state", "none");
  expect(await redirectOf(() => setThumbsSignal(thumbs))).toContain(
    "/courses/COMP/2000?signal=updated#signals",
  );
  const emoji = instructorForm();
  emoji.set("code", "fire");
  emoji.set("selected", "false");
  expect(await redirectOf(() => setEmojiSignal(emoji))).toContain(
    "/instructors/00000000-0000-4000-8000-000000000001?signal=updated#signals",
  );
  expect(mutations).toEqual([
    {
      type: "thumbs",
      id: userId,
      input: {
        target: { type: "course", coursePrefix: "COMP", courseNumber: "2000" },
        state: "none",
      },
    },
    {
      type: "emoji",
      id: userId,
      input: {
        target: {
          type: "instructor",
          instructorUuid: "00000000-0000-4000-8000-000000000001",
        },
        code: "fire",
        selected: false,
      },
    },
  ]);

  mutationError = new SignalWriteError("onboarding-required", "Onboard first");
  const onboarding = courseForm();
  onboarding.set("state", "up");
  expect(await redirectOf(() => setThumbsSignal(onboarding))).toContain(
    "/onboarding?r=%2Fcourses%2FCOMP%2F2000",
  );
  mutationError = undefined;
});

test("Review signal actions preserve a validated originating query and Review anchor", async () => {
  const { setThumbsSignal } = await import("@/app/signals/actions");
  origin = "https://rankings.example";
  referer =
    "https://rankings.example/courses/COMP/2000?term=2510&q=hard#review-old";
  userId = "00000000-0000-4000-8000-000000000047";
  mutationError = undefined;
  mutations.length = 0;
  const review = reviewForm();
  review.set("state", "up");

  expect(await redirectOf(() => setThumbsSignal(review))).toContain(
    "/courses/COMP/2000?term=2510&q=hard&signal=updated#review-00000000-0000-4000-8000-000000000010",
  );
  expect(mutations).toEqual([
    {
      type: "thumbs",
      id: userId,
      input: {
        target: {
          type: "review",
          reviewId: "00000000-0000-4000-8000-000000000010",
        },
        state: "up",
      },
    },
  ]);

  referer = "https://evil.example/stolen?term=2510";
  expect(await redirectOf(() => setThumbsSignal(review))).toContain(
    "/reviews/00000000-0000-4000-8000-000000000010?signal=updated#review-00000000-0000-4000-8000-000000000010",
  );
  referer = undefined;
});

test("signal actions reject malformed entity kinds and arbitrary Emoji input", async () => {
  const { setEmojiSignal } = await import("@/app/signals/actions");
  origin = "https://rankings.example";
  userId = "00000000-0000-4000-8000-000000000047";
  mutations.length = 0;
  const malformed = new FormData();
  malformed.set("targetType", "class");
  malformed.set("code", "👍");
  malformed.set("selected", "yes");

  expect(await redirectOf(() => setEmojiSignal(malformed))).toContain(
    "/rankings/courses?signalError=invalid-signal#signals",
  );
  expect(mutations).toEqual([]);
});
