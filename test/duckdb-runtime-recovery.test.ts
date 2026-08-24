import { expect, test, vi } from "vitest";
import { connectDuckDB } from "@/lib/duckdb";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@duckdb/node-api", () => ({
  DuckDBInstance: { create: mocks.create },
}));

test("a failed DuckDB initialization can be retried", async () => {
  const connection = { run: vi.fn() };
  mocks.create
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({ connect: () => connection });

  await expect(connectDuckDB()).rejects.toThrow("temporary failure");
  await expect(connectDuckDB()).resolves.toBe(connection);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
