import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";

export const browserContributionsSchema = "browser_fixture";
export const browserReviewIds = {
  quality: "30000000-0000-4000-8000-000000000101",
  popular: "30000000-0000-4000-8000-000000000102",
  recent: "30000000-0000-4000-8000-000000000103",
} as const;
export const browserParticipantIds = Array.from(
  { length: 9 },
  (_, index) =>
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

export function browserContributionsUrl() {
  if (!connection) return "";
  const url = new URL(connection);
  url.searchParams.set(
    "options",
    `-csearch_path=${browserContributionsSchema}`,
  );
  return url.toString();
}

export async function seedBrowserContributions() {
  if (!connection) return;
  const admin = postgres(connection, { max: 1, onnotice: () => {} });
  await admin.unsafe(
    `DROP SCHEMA IF EXISTS ${browserContributionsSchema} CASCADE`,
  );
  await admin.unsafe(`CREATE SCHEMA ${browserContributionsSchema}`);
  await admin.end();

  const sql = postgres(connection, {
    max: 1,
    connection: { search_path: browserContributionsSchema },
    onnotice: () => {},
  });
  try {
    for (const name of (
      await readdir(resolve("contributions/migrations"))
    ).sort())
      await sql.unsafe(
        await readFile(join("contributions/migrations", name), "utf8"),
      );

    const authorIds = [
      "10000000-0000-4000-8000-000000000101",
      "10000000-0000-4000-8000-000000000102",
      "10000000-0000-4000-8000-000000000103",
    ];
    await sql`
      INSERT INTO contribution_users (id, status, public_display_name)
      SELECT id, 'active', 'Browser Fixture User'
      FROM unnest(${[...authorIds, ...browserParticipantIds]}::uuid[]) AS users(id)
    `;

    const reviews = [
      {
        id: browserReviewIds.quality,
        revisionId: "40000000-0000-4000-8000-000000000101",
        authorId: authorIds[0] as string,
        markdown: "High quality Review",
        ageDays: 30,
      },
      {
        id: browserReviewIds.popular,
        revisionId: "40000000-0000-4000-8000-000000000102",
        authorId: authorIds[1] as string,
        markdown: "Popular Review",
        ageDays: 365,
      },
      {
        id: browserReviewIds.recent,
        revisionId: "40000000-0000-4000-8000-000000000103",
        authorId: authorIds[2] as string,
        markdown: "Recent Review",
        ageDays: 0,
      },
    ];
    for (const review of reviews) {
      await sql`
        INSERT INTO reviews (
          id, author_user_id, publication_state, course_prefix,
          course_number, current_revision_id
        ) VALUES (
          ${review.id}, ${review.authorId}, 'active', 'COMP', '2000', NULL
        )
      `;
      await sql`
        INSERT INTO review_revisions (
          id, review_id, markdown, attribution, captured_display_name,
          policy_version, published_at
        ) VALUES (
          ${review.revisionId}, ${review.id}, ${review.markdown}, 'attributed',
          'Browser Fixture User', 'browser-fixture-v1',
          now() - ${review.ageDays} * interval '1 day'
        )
      `;
      await sql`
        INSERT INTO review_course_bases (
          revision_id, course_prefix, course_number
        ) VALUES (${review.revisionId}, 'COMP', '2000')
      `;
      await sql`
        UPDATE reviews SET current_revision_id = ${review.revisionId}
        WHERE id = ${review.id}
      `;
    }

    await sql`
      INSERT INTO review_thumbs_votes (user_id, review_id, state)
      SELECT id, ${browserReviewIds.quality}, 'up'
      FROM unnest(${browserParticipantIds.slice(0, 8)}::uuid[]) AS users(id)
    `;
    await sql`
      INSERT INTO review_thumbs_votes (user_id, review_id, state)
      VALUES (${browserParticipantIds[0]}, ${browserReviewIds.popular}, 'up')
    `;
    await sql`
      INSERT INTO review_thumbs_votes (user_id, review_id, state)
      SELECT id, ${browserReviewIds.popular}, 'down'
      FROM unnest(${browserParticipantIds.slice(1, 5)}::uuid[]) AS users(id)
    `;
    await sql`
      INSERT INTO review_emoji_reactions (user_id, review_id, code)
      VALUES
        (${browserParticipantIds[5]}, ${browserReviewIds.popular}, 'love'),
        (${browserParticipantIds[6]}, ${browserReviewIds.popular}, 'laugh'),
        (${browserParticipantIds[7]}, ${browserReviewIds.popular}, 'sad'),
        (${browserParticipantIds[8]}, ${browserReviewIds.popular}, 'fire')
    `;
  } finally {
    await sql.end();
  }
}
