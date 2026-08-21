import { expect, mock, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { createModerationService } from "@/lib/contributions/moderation";
import { createReviewService } from "@/lib/contributions/reviews";

mock.module("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const OPERATOR = "deploy-operator";

if (!connection) {
  test.skip("Moderation PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Moderation PostgreSQL contract covers reports, privacy, operator actions, and lookup reasons", async () => {
    const schema = `moderation_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = postgres(connection, {
      max: 4,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    let moderationSql: ReturnType<typeof postgres> | undefined;
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
      const { PostgresModerationRepository, PostgresReviewRepository } =
        await import("@/lib/contributions/postgres");
      const reviews = createReviewService(new PostgresReviewRepository(sql), {
        reviewPolicyVersion: "review-test-v1",
        async validateAssociations(associations) {
          return associations;
        },
      });
      moderationSql = postgres(connection, {
        max: 2,
        connection: { search_path: schema },
        onnotice: () => {},
      });
      const moderation = createModerationService(
        new PostgresModerationRepository(moderationSql),
      );
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
      const authorId = crypto.randomUUID();
      const reporterId = crypto.randomUUID();
      const otherReporterId = crypto.randomUUID();
      const onboardingId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES
          (${authorId}, 'active', 'Abusive Name'),
          (${reporterId}, 'active', 'Reporter Student'),
          (${otherReporterId}, 'active', 'Second Reporter'),
          (${onboardingId}, 'onboarding', 'Not Ready')
      `;
      const review = await reviews.publishReview(authorId, {
        associations: {
          course: { coursePrefix: "COMP", courseNumber: "2000" },
        },
        markdown: "The labs are useful.",
      });
      const [casesAfterPublish] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM moderation_cases
      `;
      expect(casesAfterPublish?.count).toBe(0);
      expect(
        await reviews.listReviews({
          type: "course",
          coursePrefix: "COMP",
          courseNumber: "2000",
        }),
      ).toHaveLength(1);

      await expectWriteCode(
        () => moderation.reportReview(onboardingId, review.id, "harassment"),
        "onboarding-required",
      );
      await expectWriteCode(
        () =>
          moderation.reportReview(
            reporterId,
            crypto.randomUUID(),
            "harassment",
          ),
        "review-not-found",
      );

      const reported = await moderation.reportReview(
        reporterId,
        review.id,
        "harassment",
      );
      expect(reported).toMatchObject({
        action: "report",
        targetType: "review",
        targetId: review.id,
        reasonCategory: "harassment",
        outcome: "recorded",
      });
      expect(reported).not.toHaveProperty("reporterUserId");
      expect(reported).not.toHaveProperty("operatorIdentifier");
      const authorView = await reviews.getReview(review.id, authorId);
      expect(JSON.stringify(authorView)).not.toContain(reporterId);
      const publicView = await reviews.getReview(review.id);
      expect(JSON.stringify(publicView)).not.toContain(reporterId);

      await expectWriteCode(
        () => moderation.reportReview(reporterId, review.id, "threats"),
        "duplicate-report",
      );
      const second = await moderation.reportReview(
        otherReporterId,
        review.id,
        "doxxing",
      );
      expect(second.action).toBe("report");

      await expectWriteCode(
        () => moderation.lookupIdentity(OPERATOR, review.id, "curiosity"),
        "unjustified-lookup",
      );
      const lookedUp = await moderation.lookupIdentity(
        OPERATOR,
        review.id,
        "report",
      );
      expect(lookedUp.userId).toBe(authorId);
      expect(lookedUp.case).toMatchObject({
        action: "identity-lookup",
        identityLookupReason: "report",
        operatorIdentifier: OPERATOR,
      });
      expect(lookedUp.case).not.toHaveProperty("reporterUserId");

      const suppressed = await moderation.suppressAttribution(
        OPERATOR,
        review.id,
        "slurs",
      );
      expect(suppressed.action).toBe("suppress-attribution");
      expect(await reviews.getReview(review.id)).toMatchObject({
        attribution: "identity-hidden",
        attributionCredit: "UST Rankings contributor",
      });
      expect(
        "capturedDisplayName" in ((await reviews.getReview(review.id)) ?? {}),
      ).toBe(false);

      const storedFileId = crypto.randomUUID();
      await sql`
        INSERT INTO stored_files (
          id, owner_user_id, object_key, byte_size, sha256, detected_mime
        ) VALUES (
          ${storedFileId}, ${authorId}, ${`files/${storedFileId}`}, 12,
          ${"ab".repeat(32)}, 'image/jpeg'
        )
      `;
      const removed = await moderation.removeStoredFile(
        OPERATOR,
        storedFileId,
        "malicious-files",
      );
      expect(removed).toMatchObject({
        action: "remove-stored-file",
        targetType: "stored-file",
        targetId: storedFileId,
      });
      const [queued] = await sql<
        { requested: Date | null; gone: Date | null }[]
      >`
        SELECT removal_requested_at AS requested, removed_at AS gone
        FROM stored_files WHERE id = ${storedFileId}
      `;
      expect(queued?.requested).toBeTruthy();
      expect(queued?.gone).toBeNull();

      const withdrawn = await moderation.withdrawReview(
        OPERATOR,
        review.id,
        "threats",
      );
      expect(withdrawn.action).toBe("withdraw-review");
      expect(await reviews.getReview(review.id)).toBeUndefined();
      const [history] = await sql<{ state: string; revisions: number }[]>`
        SELECT publication_state AS state, count(rr.id)::int AS revisions
        FROM reviews r
        JOIN review_revisions rr ON rr.review_id = r.id
        WHERE r.id = ${review.id}
        GROUP BY publication_state
      `;
      expect(history).toEqual({ state: "withdrawn", revisions: 1 });

      await expectWriteCode(
        () =>
          moderation.lookupIdentity(OPERATOR, crypto.randomUUID(), "report"),
        "review-not-found",
      );
      const untouched = await reviews.publishReview(authorId, {
        associations: {
          course: { coursePrefix: "COMP", courseNumber: "2011" },
        },
        markdown: "Another Review.",
      });
      await expectWriteCode(
        () => moderation.lookupIdentity(OPERATOR, untouched.id, "report"),
        "no-concrete-report",
      );
      const legal = await moderation.lookupIdentity(
        OPERATOR,
        untouched.id,
        "legal-request",
      );
      expect(legal.userId).toBe(authorId);

      const suspended = await moderation.suspendUser(
        OPERATOR,
        authorId,
        "harassment",
      );
      expect(suspended).toMatchObject({
        action: "suspend-user",
        targetType: "user",
        targetId: authorId,
      });
      await expect(
        reviews.publishReview(authorId, {
          associations: {
            course: { coursePrefix: "COMP", courseNumber: "2012" },
          },
          markdown: "Suspended write.",
        }),
      ).rejects.toMatchObject({ code: "account-suspended" });

      const [caseCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM moderation_cases
      `;
      expect(caseCount?.count).toBe(8);
      const [columns] = await sql<{ names: string[] }[]>`
        SELECT array_agg(column_name::text ORDER BY column_name) AS names
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'moderation_cases'
      `;
      expect(columns?.names).toEqual([
        "action",
        "created_at",
        "id",
        "identity_lookup_reason",
        "operator_identifier",
        "outcome",
        "reason_category",
        "target_id",
        "target_type",
      ]);
      expect(columns?.names).not.toContain("ip");
      expect(columns?.names).not.toContain("reporter_user_id");
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
      await moderationSql?.end();
    }
  }, 30_000);
}
