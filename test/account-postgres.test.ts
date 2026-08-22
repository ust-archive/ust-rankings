import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { expect, test, vi } from "vitest";
import { HKUST_CONNECT_ISSUER } from "@/lib/auth/policy";
import { createAccountService } from "@/lib/contributions/accounts";

vi.mock("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

if (!connection) {
  test.skip("account PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("account PostgreSQL contract preserves identity uniqueness and current status", async () => {
    const schema = `account_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = postgres(connection, {
      max: 2,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    try {
      await sql.unsafe(
        await readFile(
          join(
            process.cwd(),
            "contributions",
            "migrations",
            "0001_accounts.sql",
          ),
          "utf8",
        ),
      );
      const { PostgresAccountRepository } = await import(
        "@/lib/contributions/postgres"
      );
      const accounts = createAccountService(
        new PostgresAccountRepository(sql),
        {
          privacyPolicyVersion: "privacy-test-v1",
          communityRulesVersion: "community-test-v1",
        },
      );
      const claims = {
        iss: HKUST_CONNECT_ISSUER,
        sub: "postgres-subject",
        name: "Database Student",
        email: "student@connect.ust.hk",
      };
      const [first, concurrent] = await Promise.all([
        accounts.establishUser(claims),
        accounts.establishUser({ ...claims, name: "Current Profile Name" }),
      ]);
      expect(concurrent.id).toBe(first.id);
      const [userCount] = await sql<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM contribution_users`;
      expect(userCount?.count).toBe(1);

      await accounts.completeOnboarding(first.id, {
        publicDisplayName: "Public Student",
        acceptPrivacy: true,
        acceptCommunity: true,
      });
      await sql`UPDATE contribution_users SET status = 'suspended' WHERE id = ${first.id}`;
      await expect(accounts.requireActiveUser(first.id)).rejects.toMatchObject({
        code: "account-suspended",
      });
      let bindingError: unknown;
      try {
        await sql`UPDATE external_identities SET user_id = ${crypto.randomUUID()} WHERE issuer = ${HKUST_CONNECT_ISSUER}`;
      } catch (error) {
        bindingError = error;
      }
      expect(String(bindingError)).toContain(
        "External Identity bindings are immutable",
      );

      for (const migration of [
        "0002_course_reviews.sql",
        "0003_signals.sql",
        "0004_complete_review_associations.sql",
        "0005_review_lifecycle.sql",
        "0006_raster_attachments.sql",
        "0007_document_attachments.sql",
        "0008_moderation.sql",
        "0009_rights_requests.sql",
        "0010_active_review_basis_set.sql",
        "0011_review_signals.sql",
      ]) {
        await sql.unsafe(
          await readFile(
            join(process.cwd(), "contributions", "migrations", migration),
            "utf8",
          ),
        );
      }
      await sql`UPDATE contribution_users SET status = 'active' WHERE id = ${first.id}`;
      const reviewId = crypto.randomUUID();
      const withdrawnReviewId = crypto.randomUUID();
      await sql`
        INSERT INTO reviews (id, author_user_id, publication_state, course_prefix, course_number)
        VALUES
          (${reviewId}, ${first.id}, 'active', 'COMP', '2000'),
          (${withdrawnReviewId}, ${first.id}, 'withdrawn', 'MATH', '1000')
      `;
      await sql`
        INSERT INTO course_emoji_reactions
          (user_id, course_prefix, course_number, code, created_at)
        VALUES (${first.id}, 'COMP', '2000', 'love', '2026-08-21T00:00:00Z')
      `;
      await sql`
        INSERT INTO course_thumbs_votes
          (user_id, course_prefix, course_number, state, updated_at)
        VALUES (${first.id}, 'COMP', '2000', 'up', '2026-08-20T00:00:00Z')
      `;
      await sql`
        INSERT INTO review_emoji_reactions
          (user_id, review_id, code, created_at)
        VALUES
          (${first.id}, ${reviewId}, 'fire', '2026-08-22T00:00:00Z'),
          (${first.id}, ${reviewId}, 'love', '2026-08-19T00:00:00Z'),
          (${first.id}, ${withdrawnReviewId}, 'sad', '2026-08-23T00:00:00Z')
      `;
      await sql`
        INSERT INTO review_thumbs_votes
          (user_id, review_id, state, updated_at)
        VALUES (${first.id}, ${reviewId}, 'down', '2026-08-18T00:00:00Z')
      `;
      expect(await accounts.getContributions(first.id)).toMatchObject({
        reviews: [
          {
            id: reviewId,
            publicationState: "active",
            coursePrefix: "COMP",
            courseNumber: "2000",
          },
        ],
        reactions: [
          {
            targetType: "review",
            reviewId,
            kind: "emoji",
            code: "fire",
          },
          {
            targetType: "course",
            coursePrefix: "COMP",
            courseNumber: "2000",
            kind: "emoji",
            code: "love",
          },
          {
            targetType: "course",
            coursePrefix: "COMP",
            courseNumber: "2000",
            kind: "thumb",
            code: "up",
          },
          {
            targetType: "review",
            reviewId,
            kind: "emoji",
            code: "love",
          },
          {
            targetType: "review",
            reviewId,
            kind: "thumb",
            code: "down",
          },
        ],
      });
      const [retainedWithdrawnReaction] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM review_emoji_reactions
        WHERE review_id = ${withdrawnReviewId}
      `;
      expect(retainedWithdrawnReaction?.count).toBe(1);
      expect(await accounts.closeAccount(first.id)).toMatchObject({
        id: first.id,
        status: "closed",
      });
      const [reviewState] = await sql<{ state: string }[]>`
        SELECT publication_state AS state FROM reviews WHERE author_user_id = ${first.id}
      `;
      expect(reviewState?.state).toBe("withdrawn");
      await expect(accounts.requireActiveUser(first.id)).rejects.toMatchObject({
        code: "account-closed",
      });
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  });
}
