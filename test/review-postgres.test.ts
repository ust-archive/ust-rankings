import { expect, mock, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { createReviewService } from "@/lib/contributions/reviews";

mock.module("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

if (!connection) {
  test.skip("Review PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Review PostgreSQL contract publishes and reads atomically with current authorization and tuple uniqueness", async () => {
    const schema = `review_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = postgres(connection, {
      max: 4,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    try {
      for (const name of (
        await readdir(join(process.cwd(), "contributions", "migrations"))
      ).sort())
        await sql.unsafe(
          await readFile(
            join(process.cwd(), "contributions", "migrations", name),
            "utf8",
          ),
        );
      const { PostgresReviewRepository } = await import(
        "@/lib/contributions/postgres"
      );
      const service = (client: ReturnType<typeof postgres>) =>
        createReviewService(new PostgresReviewRepository(client), {
          reviewPolicyVersion: "review-test-v1",
          async courseExists({ coursePrefix, courseNumber }) {
            return coursePrefix === "COMP" && courseNumber === "2000";
          },
        });
      const reviews = service(sql);
      const publish = async (
        userId: string,
        input: { coursePrefix: string; courseNumber: string; markdown: string },
      ) => {
        const client = postgres(connection, {
          max: 1,
          connection: { search_path: schema },
          onnotice: () => {},
        });
        try {
          return await service(client).publishCourseReview(userId, input);
        } finally {
          await client.end({ timeout: 0 });
        }
      };
      const activeId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${activeId}, 'active', 'Captured Student')
      `;

      const published = await publish(activeId, {
        coursePrefix: "COMP",
        courseNumber: "2000",
        markdown: "Useful **labs** and clear examples.",
      });
      await expect(
        publish(activeId, {
          coursePrefix: "COMP",
          courseNumber: "2000",
          markdown: "A duplicate tuple.",
        }),
      ).rejects.toMatchObject({ code: "duplicate-review" });
      await expect(
        publish(activeId, {
          coursePrefix: "MATH",
          courseNumber: "1012",
          markdown: "Unsupported Course.",
        }),
      ).rejects.toMatchObject({ code: "invalid-course" });

      for (const status of ["onboarding", "suspended", "closed"] as const) {
        const userId = crypto.randomUUID();
        await sql`
          INSERT INTO contribution_users (id, status, public_display_name)
          VALUES (${userId}, ${status}, 'Blocked Student')
        `;
        await expect(
          publish(userId, {
            coursePrefix: "COMP",
            courseNumber: "2000",
            markdown: "Must not publish.",
          }),
        ).rejects.toMatchObject({
          code:
            status === "onboarding"
              ? "onboarding-required"
              : status === "suspended"
                ? "account-suspended"
                : "account-closed",
        });
      }
      await expect(
        publish(crypto.randomUUID(), {
          coursePrefix: "COMP",
          courseNumber: "2000",
          markdown: "Missing User.",
        }),
      ).rejects.toMatchObject({ code: "account-not-found" });

      const rollbackUserId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${rollbackUserId}, 'active', 'Rollback Student')
      `;
      await sql.unsafe(`
        CREATE FUNCTION reject_rollback_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.markdown = 'force rollback' THEN
            RAISE EXCEPTION 'forced revision failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reject_rollback_revision
        BEFORE INSERT ON review_revisions
        FOR EACH ROW EXECUTE FUNCTION reject_rollback_revision();
      `);
      await expect(
        publish(rollbackUserId, {
          coursePrefix: "COMP",
          courseNumber: "2000",
          markdown: "force rollback",
        }),
      ).rejects.toThrow("forced revision failure");
      const [rolledBack] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM reviews WHERE author_user_id = ${rollbackUserId}
      `;
      expect(rolledBack?.count).toBe(0);

      await sql`
        UPDATE contribution_users
        SET public_display_name = 'Later Name'
        WHERE id = ${activeId}
      `;
      expect(
        await reviews.listCourseReviews({
          coursePrefix: "COMP",
          courseNumber: "2000",
        }),
      ).toEqual([{ ...published, capturedDisplayName: "Captured Student" }]);
      const [revision] = await sql<
        { attribution: string; policyVersion: string; basisCount: number }[]
      >`
        SELECT rr.attribution,
               rr.policy_version AS "policyVersion",
               count(rcb.revision_id)::int AS "basisCount"
        FROM review_revisions rr
        JOIN review_course_bases rcb ON rcb.revision_id = rr.id
        WHERE rr.id = ${published.revisionId}
        GROUP BY rr.attribution, rr.policy_version
      `;
      expect(revision).toEqual({
        attribution: "attributed",
        policyVersion: "review-test-v1",
        basisCount: 1,
      });
      let immutableError: unknown;
      try {
        await sql`UPDATE review_revisions SET markdown = 'rewritten' WHERE id = ${published.revisionId}`;
      } catch (error) {
        immutableError = error;
      }
      expect(String(immutableError)).toContain(
        "Review Revisions are immutable",
      );
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  }, 30_000);
}
