import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type postgres from "postgres";
import { expect, test, vi } from "vitest";
import { HKUST_CONNECT_ISSUER } from "@/lib/auth/policy";
import { createAccountService } from "@/lib/contributions/accounts";
import { PostgresAccountRepository } from "@/lib/contributions/postgres";
import { withPostgresSchema } from "./postgres-fixture";

vi.mock("server-only", () => ({}));

test("account contribution reads normalize serialized timestamp strings", async () => {
  const sql = vi
    .fn()
    .mockResolvedValueOnce([
      {
        id: "00000000-0000-4000-8000-000000000001",
        publicationState: "active",
        coursePrefix: "COMP",
        courseNumber: "2000",
        instructorUuid: null,
        publishedAt: "2026-08-20T12:00:00.000Z",
      },
    ])
    .mockResolvedValueOnce([
      {
        targetType: "review",
        coursePrefix: "COMP",
        courseNumber: "2000",
        instructorUuid: null,
        reviewId: "00000000-0000-4000-8000-000000000002",
        reviewAuthor: null,
        kind: "emoji",
        code: "love",
        createdAt: "2026-08-21T12:00:00.000Z",
      },
    ]);
  const repository = new PostgresAccountRepository(
    sql as unknown as ReturnType<typeof postgres>,
  );

  const contributions = await repository.findContributions(
    "00000000-0000-4000-8000-000000000003",
  );

  expect(contributions.reviews[0]?.publishedAt).toEqual(
    new Date("2026-08-20T12:00:00.000Z"),
  );
  expect(contributions.reactions[0]?.createdAt).toEqual(
    new Date("2026-08-21T12:00:00.000Z"),
  );
});

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

if (!connection) {
  test.skip("account PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("operator account closure removes Review reactions and votes", async () => {
    await withPostgresSchema("closure", async ({ sql, schemaUrl }) => {
      const userId = crypto.randomUUID();
      const authorId = crypto.randomUUID();
      const reviewId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      await sql`INSERT INTO contribution_users (id, status, public_display_name) VALUES (${userId}, 'active', 'Closing User'), (${authorId}, 'active', 'Author')`;
      await sql`SELECT publish_review(${reviewId}, ${revisionId}, ${authorId}, 'COMP', '2000', NULL, NULL, NULL, 'Useful labs.', 'attributed', 'review-test-v1')`;
      await sql`INSERT INTO review_thumbs_votes (user_id, review_id, state) VALUES (${userId}, ${reviewId}, 'up')`;
      await sql`INSERT INTO review_emoji_reactions (user_id, review_id, code) VALUES (${userId}, ${reviewId}, 'love')`;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "scripts/moderate.ts",
          "close-account",
          userId,
          "test-operator",
          "closure-request",
        ],
        {
          env: { ...process.env, CONTRIBUTIONS_POSTGRES_URL: schemaUrl },
        },
      );
      expect(stdout).toContain(`Closed account ${userId}`);
      expect(
        (
          await sql`SELECT status FROM contribution_users WHERE id = ${userId}`
        )[0].status,
      ).toBe("closed");
      expect(
        await sql`SELECT user_id FROM review_thumbs_votes WHERE user_id = ${userId}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT user_id FROM review_emoji_reactions WHERE user_id = ${userId}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT id FROM rights_requests WHERE user_id = ${userId} AND kind = 'closure'`,
      ).toHaveLength(1);
    });
  });

  test("account PostgreSQL contract preserves identity uniqueness and current status", async () => {
    await withPostgresSchema("account", async ({ sql }) => {
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

      await sql`UPDATE contribution_users SET status = 'active' WHERE id = ${first.id}`;
      const reviewId = crypto.randomUUID();
      const reviewRevisionId = crypto.randomUUID();
      const withdrawnReviewId = crypto.randomUUID();
      const withdrawnRevisionId = crypto.randomUUID();
      await sql`
        INSERT INTO reviews (id, author_user_id, publication_state, course_prefix, course_number)
        VALUES
          (${reviewId}, ${first.id}, 'active', 'COMP', '2000'),
          (${withdrawnReviewId}, ${first.id}, 'withdrawn', 'MATH', '1000')
      `;
      await sql`
        INSERT INTO review_revisions (
          id, review_id, markdown, attribution, captured_display_name,
          policy_version
        ) VALUES
          (${reviewRevisionId}, ${reviewId}, 'Active review', 'attributed',
           'Review Author', 'review-test-v1'),
          (${withdrawnRevisionId}, ${withdrawnReviewId}, 'Withdrawn review',
           'identity-hidden', NULL, 'review-test-v1')
      `;
      await sql`
        UPDATE reviews SET current_revision_id = ${reviewRevisionId}
        WHERE id = ${reviewId}
      `;
      await sql`
        UPDATE reviews SET current_revision_id = ${withdrawnRevisionId}
        WHERE id = ${withdrawnReviewId}
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
            reviewAuthor: "Review Author",
            coursePrefix: "COMP",
            courseNumber: "2000",
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
            reviewAuthor: "Review Author",
            coursePrefix: "COMP",
            courseNumber: "2000",
            kind: "emoji",
            code: "love",
          },
          {
            targetType: "review",
            reviewId,
            reviewAuthor: "Review Author",
            coursePrefix: "COMP",
            courseNumber: "2000",
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
    });
  });
}
