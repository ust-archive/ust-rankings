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
  test("Review PostgreSQL contract enforces one active Review per Basis set and aggregates durable associations", async () => {
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
        markdown = `Review ${JSON.stringify(associations)}`,
      ) => {
        const client = postgres(connection, {
          max: 1,
          connection: { search_path: schema },
          onnotice: () => {},
        });
        try {
          return await service(client).publishReview(userId, {
            associations,
            markdown,
          });
        } finally {
          await client.end({ timeout: 0 });
        }
      };
      const expectWriteCode = async (
        run: () => Promise<unknown>,
        code: string,
      ) => {
        let caught: unknown;
        try {
          await run();
        } catch (error) {
          caught = error;
        }
        expect(caught).toMatchObject({ code });
      };
      const activeId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${activeId}, 'active', 'Captured Student')
      `;
      const course = { coursePrefix: "COMP", courseNumber: "2000" };
      const shapes: ReviewAssociations[] = [
        { course },
        { instructorUuid: INSTRUCTOR_UUID, termCode: "2510" },
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

      for (const duplicate of [
        { course, termCode: "2510" },
        { instructorUuid: INSTRUCTOR_UUID },
        { course, instructorUuid: INSTRUCTOR_UUID },
      ])
        await expect(publish(activeId, duplicate)).rejects.toMatchObject({
          code: "duplicate-review",
        });
      expect(
        await reviews.listReviews({ type: "course", ...course }),
      ).toHaveLength(2);
      expect(
        await reviews.listReviews({
          type: "course",
          ...course,
          termCode: "2510",
        }),
      ).toHaveLength(1);
      expect(
        await reviews.listReviews({
          type: "course",
          ...course,
          termCode: "2510",
          section: "L1",
        }),
      ).toHaveLength(1);
      expect(
        await reviews.listReviews({
          type: "instructor",
          instructorUuids: [INSTRUCTOR_UUID],
        }),
      ).toHaveLength(2);
      const retiredInstructorUuid = "00000000-0000-4000-8000-000000000046";
      const retiredReview = await publish(activeId, {
        instructorUuid: retiredInstructorUuid,
      });
      const familyReviews = await reviews.listReviews({
        type: "instructor",
        instructorUuids: [INSTRUCTOR_UUID, retiredInstructorUuid],
      });
      expect(familyReviews).toHaveLength(3);
      expect(
        familyReviews.some((review) => review.id === retiredReview.id),
      ).toBe(true);

      const dual = published[2];
      const complete = published[2];
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
      for (const mutation of [
        `UPDATE review_revisions SET markdown = 'rewritten' WHERE id = '${complete.revisionId}'`,
        `UPDATE review_course_bases SET course_number = '2001' WHERE revision_id = '${complete.revisionId}'`,
        `UPDATE review_instructor_bases SET instructor_uuid = '${retiredInstructorUuid}' WHERE revision_id = '${complete.revisionId}'`,
        `UPDATE review_contexts SET term_code = '2520' WHERE revision_id = '${complete.revisionId}'`,
      ]) {
        let immutableError: unknown;
        try {
          await sql.unsafe(mutation);
        } catch (error) {
          immutableError = error;
        }
        expect(String(immutableError)).toContain(
          "Review Revisions are immutable",
        );
      }

      const lifecycleUserId = crypto.randomUUID();
      const wrongOwnerId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES
          (${lifecycleUserId}, 'active', 'First Captured Name'),
          (${wrongOwnerId}, 'active', 'Wrong Owner')
      `;
      const lifecycleOriginal = await publish(lifecycleUserId, { course });
      expect(await reviews.getReview(lifecycleOriginal.id)).toMatchObject({
        id: lifecycleOriginal.id,
        revisionId: lifecycleOriginal.revisionId,
        course,
      });
      await sql`
        UPDATE contribution_users
        SET public_display_name = 'Later Display Name'
        WHERE id = ${lifecycleUserId}
      `;
      const identityHidden = await reviews.editReview(
        lifecycleUserId,
        lifecycleOriginal.id,
        {
          expectedRevisionId: lifecycleOriginal.revisionId,
          associations: { course, termCode: "2510" },
          markdown: "Identity-hidden edit.",
          attribution: "identity-hidden",
        },
      );
      expect(identityHidden).toMatchObject({
        attribution: "identity-hidden",
        attributionCredit: "Anonymous Reviewer",
      });
      expect(await reviews.getReview(lifecycleOriginal.id)).toMatchObject({
        id: lifecycleOriginal.id,
        revisionId: identityHidden.revisionId,
        course,
        termCode: "2510",
      });
      expect("capturedDisplayName" in identityHidden).toBe(false);
      const [historyAfterHidden] = await sql<
        { revisions: number; capturedNames: string[] }[]
      >`
        SELECT count(*)::int AS revisions,
               array_remove(array_agg(captured_display_name ORDER BY published_at), NULL) AS "capturedNames"
        FROM review_revisions WHERE review_id = ${lifecycleOriginal.id}
      `;
      expect(historyAfterHidden).toEqual({
        revisions: 2,
        capturedNames: ["First Captured Name"],
      });
      const publicAfterHidden = await reviews.listReviews({
        type: "course",
        ...course,
      });
      const publicIdentityHidden = publicAfterHidden.find(
        (review) => review.id === lifecycleOriginal.id,
      );
      expect(publicIdentityHidden).toMatchObject({
        id: lifecycleOriginal.id,
        revisionId: identityHidden.revisionId,
        attribution: "identity-hidden",
        attributionCredit: "Anonymous Reviewer",
      });
      expect("capturedDisplayName" in (publicIdentityHidden ?? {})).toBe(false);
      expect("viewerCanEdit" in (publicIdentityHidden ?? {})).toBe(false);
      expect(
        (
          await reviews.listReviews(
            { type: "course", ...course },
            lifecycleUserId,
          )
        ).find((review) => review.id === lifecycleOriginal.id),
      ).toMatchObject({ viewerCanEdit: true });
      await expectWriteCode(
        () =>
          reviews.editReview(lifecycleUserId, lifecycleOriginal.id, {
            expectedRevisionId: lifecycleOriginal.revisionId,
            associations: { course },
            markdown: "Stale overwrite.",
            attribution: "attributed",
          }),
        "stale-review",
      );
      await expectWriteCode(
        () =>
          reviews.editReview(wrongOwnerId, lifecycleOriginal.id, {
            expectedRevisionId: identityHidden.revisionId,
            associations: { course },
            markdown: "Wrong owner overwrite.",
            attribution: "attributed",
          }),
        "wrong-owner",
      );

      const attributedAgain = await reviews.editReview(
        lifecycleUserId,
        lifecycleOriginal.id,
        {
          expectedRevisionId: identityHidden.revisionId,
          associations: { course },
          markdown: "Attributed again.",
          attribution: "attributed",
        },
      );
      expect(attributedAgain).toMatchObject({
        attribution: "attributed",
        attributionCredit: "Later Display Name",
        capturedDisplayName: "Later Display Name",
      });
      await publish(lifecycleUserId, { instructorUuid: INSTRUCTOR_UUID });
      await expectWriteCode(
        () =>
          reviews.editReview(lifecycleUserId, lifecycleOriginal.id, {
            expectedRevisionId: attributedAgain.revisionId,
            associations: { instructorUuid: INSTRUCTOR_UUID },
            markdown: "Colliding reassociation.",
            attribution: "attributed",
          }),
        "duplicate-review",
      );
      await expectWriteCode(
        () =>
          reviews.withdrawReview(
            wrongOwnerId,
            lifecycleOriginal.id,
            attributedAgain.revisionId,
          ),
        "wrong-owner",
      );
      await reviews.withdrawReview(
        lifecycleUserId,
        lifecycleOriginal.id,
        attributedAgain.revisionId,
      );
      expect(
        (await reviews.listReviews({ type: "course", ...course })).some(
          (review) => review.id === lifecycleOriginal.id,
        ),
      ).toBe(false);
      expect(await reviews.getReview(lifecycleOriginal.id)).toBeUndefined();
      const [withdrawnHistory] = await sql<
        { publicationState: string; revisions: number }[]
      >`
        SELECT r.publication_state AS "publicationState",
               count(rr.id)::int AS revisions
        FROM reviews r
        JOIN review_revisions rr ON rr.review_id = r.id
        WHERE r.id = ${lifecycleOriginal.id}
        GROUP BY r.publication_state
      `;
      expect(withdrawnHistory).toEqual({
        publicationState: "withdrawn",
        revisions: 3,
      });

      const rollbackUserId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${rollbackUserId}, 'active', 'Rollback Student')
      `;
      await sql.unsafe(`
        CREATE FUNCTION reject_review_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.markdown = 'force rollback' THEN
            RAISE EXCEPTION 'forced revision failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reject_review_revision
        BEFORE INSERT ON review_revisions
        FOR EACH ROW EXECUTE FUNCTION reject_review_revision();
      `);
      await expect(
        publish(rollbackUserId, { course }, "force rollback"),
      ).rejects.toThrow("forced revision failure");
      const [rolledBack] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM reviews WHERE author_user_id = ${rollbackUserId}
      `;
      expect(rolledBack?.count).toBe(0);

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
