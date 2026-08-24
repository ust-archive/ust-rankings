import { expect, test, vi } from "vitest";
import { connectDuckDB } from "@/lib/duckdb";

vi.mock("server-only", () => ({}));

test("ranking and Schedule connections share one bounded DuckDB instance", async () => {
  const [ranking, schedule] = await Promise.all([
    connectDuckDB(),
    connectDuckDB(),
  ]);
  try {
    await ranking.run("CREATE TABLE shared_duckdb_probe AS SELECT 1 AS value");
    const reader = await schedule.runAndReadAll(
      "SELECT value, current_setting('memory_limit') AS memory_limit, current_setting('temp_directory') AS temp_directory FROM shared_duckdb_probe",
    );
    expect(reader.getRowObjectsJS()).toEqual([
      {
        value: 1,
        memory_limit: "256.0 MiB",
        temp_directory: "/tmp/ust-rankings-duckdb",
      },
    ]);
  } finally {
    await ranking.run("DROP TABLE IF EXISTS shared_duckdb_probe");
    ranking.closeSync();
    schedule.closeSync();
  }
});
