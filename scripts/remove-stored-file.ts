import postgres from "postgres";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const [storedFileId, ...extra] = Bun.argv.slice(2);
if (!storedFileId || extra.length || !UUID.test(storedFileId))
  throw new Error(
    "Usage: bun run attachments:remove-stored-file <stored-file-uuid>",
  );

const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
if (!connection)
  throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");

const sql = postgres(connection, { max: 1 });
try {
  const [row] = await sql<{ id: string }[]>`
    UPDATE stored_files
    SET removal_requested_at = COALESCE(removal_requested_at, now())
    WHERE id = ${storedFileId.toLowerCase()} AND removed_at IS NULL
    RETURNING id
  `;
  if (!row) throw new Error("Stored File was not found or is already removed");
  console.log(
    `Queued ${row.id} for confirmed byte removal. Authenticated GET /api/attachments/cleanup deletes the object, retains the Attachment Tombstone, and releases quota.`,
  );
} finally {
  await sql.end();
}
