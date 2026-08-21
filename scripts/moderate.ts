import postgres from "postgres";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REASONS = new Set([
  "third-party-personal-data",
  "doxxing",
  "threats",
  "harassment",
  "slurs",
  "discriminatory-abuse",
  "impersonation",
  "spam",
  "deceptive-links",
  "confidential-materials",
  "unsupported-allegations",
  "personal-attacks",
  "malicious-files",
  "high-risk-data",
]);
const LOOKUP_REASONS = new Set([
  "report",
  "security-incident",
  "rights-request",
  "legal-request",
]);
const CONTACT = "ust-rankings@flandia.dev";
const USAGE = `Usage:
  bun run contributions:moderate withdraw-review <review-uuid> <operator> <reason>
  bun run contributions:moderate suppress-attribution <review-uuid> <operator> <reason>
  bun run contributions:moderate remove-stored-file <stored-file-uuid> <operator> <reason>
  bun run contributions:moderate suspend-user <user-uuid> <operator> <reason>
  bun run contributions:moderate lookup-identity <review-uuid> <operator> <lookup-reason>`;

const [action, target, operator, reason, ...extra] = Bun.argv.slice(2);
if (
  extra.length ||
  !action ||
  !target ||
  !operator?.trim() ||
  !reason ||
  !UUID.test(target)
)
  throw new Error(USAGE);

const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
if (!connection)
  throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");

function notify() {
  console.log(
    `Notify the affected User through ${CONTACT} when practical. Reconsideration uses the same contact. There is no public moderation log.`,
  );
}

const sql = postgres(connection, { max: 1 });
try {
  const targetId = target.toLowerCase();
  const operatorIdentifier = operator.trim();
  if (action === "lookup-identity") {
    if (!LOOKUP_REASONS.has(reason)) throw new Error(USAGE);
    const [row] = await sql<{ id: string; user_id: string }[]>`
      SELECT id, user_id FROM operator_lookup_identity(
        ${operatorIdentifier}, ${targetId}, ${reason}
      )
    `;
    if (!row) throw new Error("Identity lookup did not complete");
    console.log(
      `Looked up User ${row.user_id} for Review ${targetId}; Moderation Case ${row.id}.`,
    );
    notify();
  } else {
    if (!REASONS.has(reason)) throw new Error(USAGE);
    const query =
      action === "withdraw-review"
        ? sql<
            { id: string }[]
          >`SELECT id FROM operator_withdraw_review(${operatorIdentifier}, ${targetId}, ${reason})`
        : action === "suppress-attribution"
          ? sql<
              { id: string }[]
            >`SELECT id FROM operator_suppress_attribution(${operatorIdentifier}, ${targetId}, ${reason})`
          : action === "remove-stored-file"
            ? sql<
                { id: string }[]
              >`SELECT id FROM operator_remove_stored_file(${operatorIdentifier}, ${targetId}, ${reason})`
            : action === "suspend-user"
              ? sql<
                  { id: string }[]
                >`SELECT id FROM operator_suspend_user(${operatorIdentifier}, ${targetId}, ${reason})`
              : undefined;
    if (!query) throw new Error(USAGE);
    const [row] = await query;
    if (!row) throw new Error("Moderation action did not complete");
    console.log(`Recorded Moderation Case ${row.id} (${action}).`);
    notify();
  }
} finally {
  await sql.end();
}
