import postgres from "postgres";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const [retiredInput, survivorInput, ...extra] = process.argv.slice(2);
if (
  !retiredInput ||
  !survivorInput ||
  extra.length ||
  !UUID.test(retiredInput) ||
  !UUID.test(survivorInput) ||
  retiredInput.toLowerCase() === survivorInput.toLowerCase()
)
  throw new Error(
    "Usage: npm run contributions:merge-instructor-signals -- <retired-uuid> <different-survivor-uuid>",
  );
const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
if (!connection)
  throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");

const retiredUuid = retiredInput.toLowerCase();
const survivorUuid = survivorInput.toLowerCase();
const sql = postgres(connection, { max: 1 });
try {
  await sql`SELECT merge_instructor_signals(${retiredUuid}, ${survivorUuid})`;
  console.log(
    `Moved Instructor signals from ${retiredUuid} to ${survivorUuid}`,
  );
} finally {
  await sql.end();
}
