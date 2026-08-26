import { expect, test, vi } from "vitest";
import { ContributionsUnavailableError } from "@/lib/contributions/signals";

vi.mock("server-only", () => ({}));
const { postgresReadSignals } = vi.hoisted(() => ({
  postgresReadSignals: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: (...args: unknown[]) => Promise<unknown>) => {
    const values = new Map<string, Promise<unknown>>();
    return (...args: unknown[]) => {
      const key = JSON.stringify(args);
      const existing = values.get(key);
      if (existing) return existing;
      const value = read(...args);
      values.set(key, value);
      return value;
    };
  },
}));
vi.mock("@/lib/contributions/postgres", () => ({
  getSignalService: () => ({ readSignals: postgresReadSignals }),
}));

const target = {
  type: "course" as const,
  coursePrefix: "COMP",
  courseNumber: "2000",
};
const summary = {
  thumbs: { up: 5, down: 2 },
  emoji: {
    love: 3,
    laugh: 0,
    surprised: 0,
    confused: 1,
    sad: 0,
    angry: 0,
    fire: 2,
  },
};

test("signal loading composes public aggregates with only the authenticated User's state", async () => {
  const { loadSignals } = await import("@/app/signals/data");
  const userId = "00000000-0000-4000-8000-000000000047";
  const reads: Array<string | undefined> = [];
  expect(
    await loadSignals(
      target,
      async (_target, currentUserId) => {
        reads.push(currentUserId);
        return {
          ...summary,
          mine: { thumbs: "up" as const, emoji: ["love" as const] },
        };
      },
      async () => userId,
    ),
  ).toEqual({
    unavailable: false,
    summary: {
      ...summary,
      mine: { thumbs: "up", emoji: ["love"] },
    },
  });
  expect(reads).toEqual([userId]);
});

test("cached Signal reads isolate each User's personalized result", async () => {
  const { loadSignals } = await import("@/app/signals/data");
  postgresReadSignals.mockReset();
  postgresReadSignals.mockImplementation(
    async (_target: unknown, userId?: string) => ({
      ...summary,
      mine: { thumbs: userId === "user-a" ? "up" : "none", emoji: [] },
    }),
  );

  await loadSignals(target, undefined, async () => "user-a");
  await loadSignals(target, undefined, async () => "user-a");
  await loadSignals(target, undefined, async () => "user-b");

  expect(postgresReadSignals.mock.calls).toEqual([
    [target, "user-a"],
    [target, "user-b"],
  ]);
});

test("signal loading distinguishes provider failure from zero and keeps public reads available without Auth configuration", async () => {
  const { loadSignals } = await import("@/app/signals/data");
  expect(
    await loadSignals(
      target,
      async () => summary,
      async () => {
        throw new Error("Auth unavailable");
      },
    ),
  ).toEqual({ summary, unavailable: false });

  expect(
    await loadSignals(target, async () => {
      throw new ContributionsUnavailableError();
    }),
  ).toEqual({ summary: undefined, unavailable: true });

  const defect = new TypeError("unexpected defect");
  await expect(
    loadSignals(target, async () => {
      throw defect;
    }),
  ).rejects.toBe(defect);
});
