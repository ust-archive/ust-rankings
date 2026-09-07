import { expect, test, vi } from "vitest";
import {
  createReviewService,
  type ReviewAssociations,
} from "@/lib/contributions/reviews";
import { createSignalService } from "@/lib/contributions/signals";
import { withPostgresSchema } from "./postgres-fixture";

vi.mock("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000045";

if (!connection) {
  test.skip("Review PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Review PostgreSQL contract enforces one active Review per Basis set and aggregates durable associations", async () => {
    await withPostgresSchema("review", async ({ sql, connect }) => {
      const { PostgresReviewRepository, PostgresSignalRepository } =
        await import("@/lib/contributions/postgres");
      const service = (client: typeof sql) =>
        createReviewService(new PostgresReviewRepository(client), {
          reviewPolicyVersion: "review-test-v1",
          async validateAssociations(associations) {
            return associations;
          },
        });
      const reviews = service(sql);
      const signals = createSignalService(new PostgresSignalRepository(sql), {
        async resolveTarget(target) {
          if (target.type !== "review") return target;
          const [active] = await sql<{ id: string }[]>`
            SELECT id FROM reviews
            WHERE id = ${target.reviewId} AND publication_state = 'active'
          `;
          return active ? target : undefined;
        },
      });
      const publish = async (
        userId: string,
        associations: ReviewAssociations,
        markdown = `Review ${JSON.stringify(associations)}`,
      ) => {
        const client = connect(1);
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

      const newestAuthorId = crypto.randomUUID();
      const participantIds = Array.from({ length: 10 }, () =>
        crypto.randomUUID(),
      );
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        SELECT id, 'active', 'Order Test User'
        FROM unnest(${[newestAuthorId, ...participantIds]}::uuid[]) AS ids(id)
      `;
      const newest = await publish(newestAuthorId, { course });
      const approved = published[0];
      const controversial = published[2];
      if (!approved || !controversial)
        throw new Error("Expected Reviews for ordering");
      await sql`
        INSERT INTO review_thumbs_votes (user_id, review_id, state)
        SELECT id, ${approved.id}, 'up'
        FROM unnest(${participantIds.slice(0, 8)}::uuid[]) AS ids(id)
      `;
      await sql`
        INSERT INTO review_thumbs_votes (user_id, review_id, state)
        SELECT ${participantIds[0]}::uuid, ${controversial.id}::uuid, 'up'
        UNION ALL
        SELECT id, ${controversial.id}::uuid, 'down'
        FROM unnest(${participantIds.slice(1, 8)}::uuid[]) AS ids(id)
      `;
      await sql`
        INSERT INTO review_emoji_reactions (user_id, review_id, code)
        VALUES
          (${participantIds[0]}, ${controversial.id}, 'angry'),
          (${participantIds[1]}, ${controversial.id}, 'fire')
      `;
      const approvedRevisionId = crypto.randomUUID();
      await sql`
        INSERT INTO review_revisions (
          id, review_id, markdown, attribution, captured_display_name,
          policy_version, published_at
        ) VALUES (
          ${approvedRevisionId}, ${approved.id}, 'Edited approved Review',
          'attributed', 'Captured Student', 'review-test-v1', now()
        )
      `;
      await sql`
        INSERT INTO review_course_bases (
          revision_id, course_prefix, course_number
        ) VALUES (
          ${approvedRevisionId}, ${course.coursePrefix}, ${course.courseNumber}
        )
      `;
      await sql`
        UPDATE reviews SET current_revision_id = ${approvedRevisionId}
        WHERE id = ${approved.id}
      `;
      const orderedIds = async (order: "top" | "popular" | "recent") =>
        (
          await reviews.listReviews({
            type: "course",
            ...course,
            order,
          })
        ).map((review) => review.id);
      expect(await orderedIds("top")).toEqual([
        approved.id,
        controversial.id,
        newest.id,
      ]);
      expect(await orderedIds("popular")).toEqual([
        controversial.id,
        approved.id,
        newest.id,
      ]);
      expect(await orderedIds("recent")).toEqual([
        approved.id,
        newest.id,
        controversial.id,
      ]);

      const formulaCourse = { coursePrefix: "TEST", courseNumber: "1000" };
      const formulaUsers = Array.from({ length: 19 }, () =>
        crypto.randomUUID(),
      );
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        SELECT id, 'active', 'Formula Test User'
        FROM unnest(${formulaUsers}::uuid[]) AS ids(id)
      `;
      const insertFormulaReview = async (
        id: string,
        revisionId: string,
        authorId: string,
        ageDays: number,
        reviewCourse = formulaCourse,
      ) => {
        await sql`
          INSERT INTO reviews (
            id, author_user_id, publication_state, course_prefix,
            course_number, current_revision_id
          ) VALUES (
            ${id}, ${authorId}, 'active', ${reviewCourse.coursePrefix},
            ${reviewCourse.courseNumber}, NULL
          )
        `;
        await sql`
          INSERT INTO review_revisions (
            id, review_id, markdown, attribution, captured_display_name,
            policy_version, published_at
          ) VALUES (
            ${revisionId}, ${id}, 'Formula Review', 'attributed',
            'Formula Test User', 'review-test-v1',
            current_date - ${ageDays} * interval '1 day'
          )
        `;
        await sql`
          INSERT INTO review_course_bases (
            revision_id, course_prefix, course_number
          ) VALUES (
            ${revisionId}, ${reviewCourse.coursePrefix},
            ${reviewCourse.courseNumber}
          )
        `;
        await sql`
          UPDATE reviews SET current_revision_id = ${revisionId}
          WHERE id = ${id}
        `;
      };
      const freshId = "10000000-0000-4000-8000-000000000101";
      const tiedDownId = "10000000-0000-4000-8000-000000000102";
      const editedOneUpId = "10000000-0000-4000-8000-000000000103";
      const busyNegativeId = "10000000-0000-4000-8000-000000000104";
      await insertFormulaReview(
        freshId,
        "20000000-0000-4000-8000-000000000101",
        formulaUsers[0] as string,
        0,
      );
      await insertFormulaReview(
        tiedDownId,
        "20000000-0000-4000-8000-000000000102",
        formulaUsers[1] as string,
        0,
      );
      await insertFormulaReview(
        editedOneUpId,
        "20000000-0000-4000-8000-000000000103",
        formulaUsers[2] as string,
        730,
      );
      const editedRevisionId = "20000000-0000-4000-8000-000000000113";
      await sql`
        INSERT INTO review_revisions (
          id, review_id, markdown, attribution, captured_display_name,
          policy_version, published_at
        ) VALUES (
          ${editedRevisionId}, ${editedOneUpId}, 'Edited Formula Review',
          'attributed', 'Formula Test User', 'review-test-v1',
          current_date - 365 * interval '1 day'
        )
      `;
      await sql`
        INSERT INTO review_course_bases (
          revision_id, course_prefix, course_number
        ) VALUES (
          ${editedRevisionId}, ${formulaCourse.coursePrefix},
          ${formulaCourse.courseNumber}
        )
      `;
      await sql`
        UPDATE reviews SET current_revision_id = ${editedRevisionId}
        WHERE id = ${editedOneUpId}
      `;
      await insertFormulaReview(
        busyNegativeId,
        "20000000-0000-4000-8000-000000000104",
        formulaUsers[3] as string,
        730,
      );
      await sql`
        INSERT INTO review_thumbs_votes (user_id, review_id, state)
        VALUES
          (${formulaUsers[4]}, ${tiedDownId}, 'down'),
          (${formulaUsers[4]}, ${editedOneUpId}, 'up')
      `;
      await sql`
        INSERT INTO review_thumbs_votes (user_id, review_id, state)
        SELECT id, ${busyNegativeId}, 'down'
        FROM unnest(${formulaUsers.slice(4)}::uuid[]) AS ids(id)
      `;
      const formulaOrder = async (order: "top" | "popular" | "recent") =>
        (
          await reviews.listReviews({
            type: "course",
            ...formulaCourse,
            order,
          })
        ).map((review) => review.id);
      expect(await formulaOrder("top")).toEqual([
        tiedDownId,
        editedOneUpId,
        freshId,
        busyNegativeId,
      ]);
      expect(await formulaOrder("popular")).toEqual([
        busyNegativeId,
        tiedDownId,
        editedOneUpId,
        freshId,
      ]);
      expect(await formulaOrder("recent")).toEqual([
        freshId,
        tiedDownId,
        editedOneUpId,
        busyNegativeId,
      ]);

      const halfLifeCourse = { coursePrefix: "TEST", courseNumber: "1500" };
      const freshQualityId = "10500000-0000-4000-8000-000000000101";
      const activityAt560DaysId = "10500000-0000-4000-8000-000000000102";
      const activityAt600DaysId = "10500000-0000-4000-8000-000000000103";
      await insertFormulaReview(
        freshQualityId,
        "20500000-0000-4000-8000-000000000101",
        formulaUsers[14] as string,
        0,
        halfLifeCourse,
      );
      await insertFormulaReview(
        activityAt560DaysId,
        "20500000-0000-4000-8000-000000000102",
        formulaUsers[15] as string,
        560,
        halfLifeCourse,
      );
      await insertFormulaReview(
        activityAt600DaysId,
        "20500000-0000-4000-8000-000000000103",
        formulaUsers[16] as string,
        600,
        halfLifeCourse,
      );
      await sql`
        INSERT INTO review_thumbs_votes (user_id, review_id, state)
        VALUES
          (${formulaUsers[17]}, ${freshQualityId}, 'up'),
          (${formulaUsers[17]}, ${activityAt560DaysId}, 'down'),
          (${formulaUsers[17]}, ${activityAt600DaysId}, 'down')
      `;
      await sql`
        INSERT INTO review_emoji_reactions (user_id, review_id, code)
        VALUES
          (${formulaUsers[18]}, ${activityAt560DaysId}, 'fire'),
          (${formulaUsers[18]}, ${activityAt600DaysId}, 'fire')
      `;
      const halfLifeOrder = async (order: "top" | "popular" | "recent") =>
        (
          await reviews.listReviews({
            type: "course",
            ...halfLifeCourse,
            order,
          })
        ).map((review) => review.id);
      expect(await halfLifeOrder("top")).toEqual([
        activityAt560DaysId,
        freshQualityId,
        activityAt600DaysId,
      ]);
      expect(await halfLifeOrder("popular")).toEqual([
        activityAt560DaysId,
        activityAt600DaysId,
        freshQualityId,
      ]);
      expect(await halfLifeOrder("recent")).toEqual([
        freshQualityId,
        activityAt560DaysId,
        activityAt600DaysId,
      ]);

      const tiedCourse = { coursePrefix: "TEST", courseNumber: "2000" };
      const tiedIds = [
        "11000000-0000-4000-8000-000000000101",
        "11000000-0000-4000-8000-000000000102",
      ];
      await insertFormulaReview(
        tiedIds[1] as string,
        "21000000-0000-4000-8000-000000000102",
        formulaUsers[12] as string,
        0,
        tiedCourse,
      );
      await insertFormulaReview(
        tiedIds[0] as string,
        "21000000-0000-4000-8000-000000000101",
        formulaUsers[13] as string,
        0,
        tiedCourse,
      );
      for (const order of ["top", "popular", "recent"] as const)
        expect(
          (
            await reviews.listReviews({
              type: "course",
              ...tiedCourse,
              order,
            })
          ).map((review) => review.id),
        ).toEqual(tiedIds);

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
      ).toHaveLength(3);
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
      const reviewTarget = {
        type: "review" as const,
        reviewId: lifecycleOriginal.id,
      };
      await signals.setThumbs(lifecycleUserId, {
        target: reviewTarget,
        state: "up",
      });
      await signals.setEmoji(lifecycleUserId, {
        target: reviewTarget,
        code: "love",
        selected: true,
      });
      await signals.setEmoji(lifecycleUserId, {
        target: reviewTarget,
        code: "fire",
        selected: true,
      });
      await signals.setEmoji(wrongOwnerId, {
        target: reviewTarget,
        code: "love",
        selected: true,
      });
      expect(await reviews.getReview(lifecycleOriginal.id)).toMatchObject({
        id: lifecycleOriginal.id,
        revisionId: lifecycleOriginal.revisionId,
        course,
        signals: {
          thumbs: { up: 1, down: 0 },
          emoji: { love: 2, fire: 1 },
        },
      });
      expect(
        await reviews.getReview(lifecycleOriginal.id, lifecycleUserId),
      ).toMatchObject({
        signals: { mine: { thumbs: "up", emoji: ["love", "fire"] } },
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
        signals: {
          thumbs: { up: 1, down: 0 },
          emoji: { love: 2, fire: 1 },
        },
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
      await expect(
        signals.setThumbs(lifecycleUserId, {
          target: reviewTarget,
          state: "down",
        }),
      ).rejects.toMatchObject({ code: "invalid-target" });
      const [retainedSignals] = await sql<{ thumbs: number; emoji: number }[]>`
        SELECT
          (SELECT count(*)::int FROM review_thumbs_votes
           WHERE review_id = ${lifecycleOriginal.id}) AS thumbs,
          (SELECT count(*)::int FROM review_emoji_reactions
           WHERE review_id = ${lifecycleOriginal.id}) AS emoji
      `;
      expect(retainedSignals).toEqual({ thumbs: 1, emoji: 3 });
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
    });
  }, 30_000);
}
