import postgres from "postgres";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const [storedFileId, operator, reason, ...extra] = process.argv.slice(2);
if (
  !storedFileId ||
  !operator?.trim() ||
  !reason ||
  extra.length ||
  !UUID.test(storedFileId)
)
  throw new Error(
    "Usage: npm run attachments:remove-stored-file -- <stored-file-uuid> <operator> <reason>",
  );

const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
if (!connection)
  throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");

const sql = postgres(connection, { max: 1 });
try {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM operator_remove_stored_file(
      ${operator.trim()}, ${storedFileId.toLowerCase()}, ${reason}
    )
  `;
  if (!row) throw new Error("Stored File was not found or is already removed");
  console.log(
    `Recorded Moderation Case ${row.id}. Authenticated GET /api/attachments/cleanup deletes the object, retains the Attachment Tombstone, and releases quota.`,
  );
  console.log(
    "Notify the affected User through ust-rankings@flandia.dev when practical. Reconsideration uses the same contact. There is no public moderation log.",
  );
} finally {
  await sql.end();
}
