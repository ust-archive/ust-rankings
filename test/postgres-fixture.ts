import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const migrationsDirectory = join(process.cwd(), "contributions", "migrations");

type PostgresClient = ReturnType<typeof postgres>;

export type PostgresScope = {
  schemaUrl: string;
  sql: PostgresClient;
  connect(max?: number): PostgresClient;
};

export async function withPostgresSchema<T>(
  prefix: string,
  run: (scope: PostgresScope) => Promise<T>,
): Promise<T> {
  if (!connection)
    throw new Error("TEST_CONTRIBUTIONS_POSTGRES_URL is not configured");

  const schema = `${prefix}_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const clients = new Set<PostgresClient>();
  const connect = (poolSize = 12) => {
    const client = postgres(connection, {
      max: poolSize,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    clients.add(client);
    return client;
  };
  const scopedUrl = new URL(connection);
  scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
  let schemaCreated = false;

  try {
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
    } finally {
      await admin.end({ timeout: 1 });
    }

    const sql = connect();
    for (const name of (await readdir(migrationsDirectory)).sort())
      await sql.unsafe(await readFile(join(migrationsDirectory, name), "utf8"));
    return await run({
      schemaUrl: scopedUrl.toString(),
      sql,
      connect,
    });
  } finally {
    await Promise.allSettled(
      [...clients].map((client) => client.end({ timeout: 1 })),
    );
    if (schemaCreated) {
      const cleanup = postgres(connection, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await cleanup.end({ timeout: 1 });
      }
    }
  }
}
