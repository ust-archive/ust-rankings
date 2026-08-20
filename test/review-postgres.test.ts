import { expect, mock, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import {
  createReviewService,
  type ReviewAssociations,
} from "@/lib/contributions/reviews";

mock.module("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000045";

if (!connection) {
  test.skip("Review PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Review PostgreSQL contract enforces complete tuples and aggregates durable associations", async () => {
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
          async validateAssociations(associations) {
            return associations;
          },
        });
      const reviews = service(sql);
      const publish = async (
        userId: string,
        associations: ReviewAssociations,
      ) => {
        const client = postgres(connection, {
          max: 1,
          connection: { search_path: schema },
          onnotice: () => {},
        });
        try {
          return await service(client).publishReview(userId, {
            associations,
            markdown: `Review ${JSON.stringify(associations)}`,
          });
        } finally {
          await client.end({ timeout: 0 });
        }
      };
      const activeId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${activeId}, 'active', 'Captured Student')
      `;
      const course = { coursePrefix: "COMP", courseNumber: "2000" };
      const shapes: ReviewAssociations[] = [
        { course },
        { instructorUuid: INSTRUCTOR_UUID },
        { course, instructorUuid: INSTRUCTOR_UUID },
        { course, termCode: "2510" },
        { instructorUuid: INSTRUCTOR_UUID, termCode: "2510" },
        { course, instructorUuid: INSTRUCTOR_UUID, termCode: "2510" },
        { course, termCode: "2510", section: "L1" },
        {
          course,
          instructorUuid: INSTRUCTOR_UUID,
          termCode: "2510",
          section: "L1",
        },
      ];
      const published: Awaited<ReturnType<typeof publish>>[] = [];
      for (const shape of shapes)
        published.push(await publish(activeId, shape));

      await expect(publish(activeId, { course })).rejects.toMatchObject({
        code: "duplicate-review",
      });
      expect(
        await reviews.listReviews({ type: "course", ...course }),
      ).toHaveLength(6);
      expect(
        await reviews.listReviews({
          type: "course",
          ...course,
          termCode: "2510",
        }),
      ).toHaveLength(4);
      expect(
        await reviews.listReviews({
          type: "course",
          ...course,
          termCode: "2510",
          section: "L1",
        }),
      ).toHaveLength(2);
      expect(
        await reviews.listReviews({
          type: "instructor",
          instructorUuid: INSTRUCTOR_UUID,
        }),
      ).toHaveLength(5);

      const dual = published[2];
      const complete = published[7];
      if (!dual || !complete) throw new Error("Expected published Reviews");
      await sql`
        UPDATE reviews SET instructor_association_status = 'needs-resolution'
        WHERE id = ${dual.id}
      `;
      const durable = await reviews.listReviews({ type: "course", ...course });
      expect(durable.find((review) => review.id === dual.id)).toMatchObject({
        course,
        instructorUuid: INSTRUCTOR_UUID,
        instructorAssociationStatus: "needs-resolution",
      });

      const [revision] = await sql<
        { courseBases: number; instructorBases: number; contexts: number }[]
      >`
        SELECT
          (SELECT count(*)::int FROM review_course_bases WHERE revision_id = ${complete.revisionId}) AS "courseBases",
          (SELECT count(*)::int FROM review_instructor_bases WHERE revision_id = ${complete.revisionId}) AS "instructorBases",
          (SELECT count(*)::int FROM review_contexts WHERE revision_id = ${complete.revisionId}) AS contexts
      `;
      expect(revision).toEqual({
        courseBases: 1,
        instructorBases: 1,
        contexts: 1,
      });

      for (const status of ["onboarding", "suspended", "closed"] as const) {
        const userId = crypto.randomUUID();
        await sql`
          INSERT INTO contribution_users (id, status, public_display_name)
          VALUES (${userId}, ${status}, 'Blocked Student')
        `;
        await expect(publish(userId, { course })).rejects.toMatchObject({
          code:
            status === "onboarding"
              ? "onboarding-required"
              : status === "suspended"
                ? "account-suspended"
                : "account-closed",
        });
      }
      await expect(
        publish(crypto.randomUUID(), { course }),
      ).rejects.toMatchObject({
        code: "account-not-found",
      });
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  }, 30_000);
}
