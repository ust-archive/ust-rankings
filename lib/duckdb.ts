import "server-only";

import { DuckDBInstance } from "@duckdb/node-api";

let dbInstance: Promise<DuckDBInstance> | undefined;

export async function connectDuckDB() {
  dbInstance ??= DuckDBInstance.create(":memory:");
  const pending = dbInstance;
  let instance: DuckDBInstance;
  try {
    instance = await pending;
  } catch (error) {
    if (dbInstance === pending) dbInstance = undefined;
    throw error;
  }
  const connection = await instance.connect();
  await connection.run("SET threads = 1");
  await connection.run("SET memory_limit = '256MiB'");
  await connection.run("SET temp_directory = '/tmp/ust-rankings-duckdb'");
  return connection;
}
