import postgres from "postgres";
import { privacyContact } from "../lib/privacy/contact";

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
const RIGHTS = new Set([
  "access",
  "correction",
  "withdrawal",
  "closure",
  "deletion",
]);
const CONTACT = privacyContact().email;
const USAGE = `Usage:
  bun run contributions:moderate withdraw-review <review-uuid> <operator> <reason>
  bun run contributions:moderate suppress-attribution <review-uuid> <operator> <reason>
  bun run contributions:moderate remove-stored-file <stored-file-uuid> <operator> <reason>
  bun run contributions:moderate suspend-user <user-uuid> <operator> <reason>
  bun run contributions:moderate close-account <user-uuid> <operator> <reason>
  bun run contributions:moderate lookup-identity <review-uuid> <operator> <lookup-reason>
  bun run contributions:moderate rights-request <user-uuid> <operator> <access|correction|withdrawal|closure|deletion>`;

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
  if (action === "rights-request") {
    if (!RIGHTS.has(reason)) throw new Error(USAGE);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO rights_requests (user_id, kind, operator_identifier)
      VALUES (${targetId}, ${reason}, ${operatorIdentifier})
      RETURNING id
    `;
    if (!row) throw new Error("Rights request was not recorded");
    console.log(
      `Recorded rights request ${row.id} (${reason}) for ${targetId}.`,
    );
    notify();
  } else if (action === "lookup-identity") {
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
  } else if (action === "close-account") {
    const closed = await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO rights_requests (user_id, kind, operator_identifier)
        VALUES (${targetId}, 'closure', ${operatorIdentifier})
      `;
      await transaction`
        UPDATE reviews
        SET publication_state = 'withdrawn', updated_at = now()
        WHERE author_user_id = ${targetId}
          AND publication_state = 'active'
      `;
      await transaction`DELETE FROM course_thumbs_votes WHERE user_id = ${targetId}`;
      await transaction`DELETE FROM instructor_thumbs_votes WHERE user_id = ${targetId}`;
      await transaction`DELETE FROM course_emoji_reactions WHERE user_id = ${targetId}`;
      await transaction`DELETE FROM instructor_emoji_reactions WHERE user_id = ${targetId}`;
      const [row] = await transaction<{ id: string }[]>`
        UPDATE contribution_users
        SET status = 'closed', updated_at = now()
        WHERE id = ${targetId} AND status <> 'closed'
        RETURNING id
      `;
      if (!row) throw new Error("Account closure did not complete");
      return row;
    });
    console.log(`Closed account ${closed.id}.`);
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
