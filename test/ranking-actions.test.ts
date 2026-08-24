import { expect, test, vi } from "vitest";

const queryRankings = vi.hoisted(() =>
  vi.fn(async () => ({
    nextCursor: undefined,
    population: { termCode: "2510" },
    results: [],
  })),
);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rankings/server", () => ({ queryRankings }));

test("the pagination server action rejects Course queries", async () => {
  const { loadMoreInstructorRankings } = await import("@/app/rankings/actions");
  await expect(
    loadMoreInstructorRankings({ entity: "course" } as never),
  ).rejects.toThrow("Only Instructor Rankings");
  expect(queryRankings).not.toHaveBeenCalled();

  await expect(
    loadMoreInstructorRankings({ entity: "instructor" }),
  ).resolves.toMatchObject({ termCode: "2510", results: [] });
  expect(queryRankings).toHaveBeenCalledOnce();
});
