import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
if (!connection)
  throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");

const sql = postgres(connection, { max: 1 });
try {
  await sql.begin(async (transaction) => {
    // One transaction-scoped lock serializes schema checks and application.
    await transaction`SELECT pg_advisory_xact_lock(1431520338, 43)`;
    await transaction`
      CREATE TABLE IF NOT EXISTS contribution_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const directory = join(
      import.meta.dir,
      "..",
      "contributions",
      "migrations",
    );
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const [applied] = await transaction<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM contribution_migrations WHERE name = ${name}
        ) AS exists
      `;
      if (applied.exists) continue;
      const migration = await readFile(join(directory, name), "utf8");
      await transaction.unsafe(migration);
      await transaction`
        INSERT INTO contribution_migrations (name) VALUES (${name})
      `;
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await sql.end();
}
