import "server-only";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  type AccountRepository,
  type AccountRow,
  createAccountService,
  type EstablishIdentityInput,
} from "./accounts";
import {
  ContributionsUnavailableError,
  type CourseBasis,
  type CourseReviewRepository,
  createReviewService,
  type PublicCourseReview,
  type PublishCourseReviewRecord,
  ReviewWriteError,
} from "./reviews";

type AccountDatabaseRow = {
  id: string;
  status: AccountRow["status"];
  publicDisplayName: string | null;
};

function account(row: AccountDatabaseRow): AccountRow {
  return {
    id: row.id,
    status: row.status,
    publicDisplayName: row.publicDisplayName,
  };
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async establishIdentity(input: EstablishIdentityInput) {
    return this.sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${input.issuer}, 43) # hashtextextended(${input.subject}, 44)
        )
      `;
      const [existing] = await transaction<AccountDatabaseRow[]>`
        SELECT u.id, u.status, u.public_display_name AS "publicDisplayName"
        FROM external_identities i
        JOIN contribution_users u ON u.id = i.user_id
        WHERE i.issuer = ${input.issuer} AND i.subject = ${input.subject}
      `;
      if (existing) {
        await transaction`
          UPDATE external_identities
          SET profile_name = ${input.profileName},
              profile_email = ${input.profileEmail},
              updated_at = now()
          WHERE issuer = ${input.issuer} AND subject = ${input.subject}
        `;
        return account(existing);
      }

      const userId = randomUUID();
      const [created] = await transaction<AccountDatabaseRow[]>`
        INSERT INTO contribution_users (id, public_display_name)
        VALUES (${userId}, ${input.suggestedDisplayName})
        RETURNING id, status, public_display_name AS "publicDisplayName"
      `;
      await transaction`
        INSERT INTO external_identities (
          issuer, subject, user_id, profile_name, profile_email
        ) VALUES (
          ${input.issuer}, ${input.subject}, ${userId},
          ${input.profileName}, ${input.profileEmail}
        )
      `;
      return account(created);
    });
  }

  async findUser(userId: string) {
    const [row] = await this.sql<AccountDatabaseRow[]>`
      SELECT id, status, public_display_name AS "publicDisplayName"
      FROM contribution_users
      WHERE id = ${userId}
    `;
    return row ? account(row) : undefined;
  }

  async activateUser(
    userId: string,
    publicDisplayName: string,
    acceptances: Array<{
      policy: "privacy" | "community";
      version: string;
    }>,
  ) {
    return this.sql.begin(async (transaction) => {
      const [current] = await transaction<AccountDatabaseRow[]>`
        SELECT id, status, public_display_name AS "publicDisplayName"
        FROM contribution_users
        WHERE id = ${userId}
        FOR UPDATE
      `;
      if (current?.status !== "onboarding") return undefined;
      for (const acceptance of acceptances) {
        await transaction`
          INSERT INTO policy_acceptances (user_id, policy, version)
          VALUES (${userId}, ${acceptance.policy}, ${acceptance.version})
          ON CONFLICT DO NOTHING
        `;
      }
      const [updated] = await transaction<AccountDatabaseRow[]>`
        UPDATE contribution_users
        SET public_display_name = ${publicDisplayName},
            status = 'active',
            updated_at = now()
        WHERE id = ${userId} AND status = 'onboarding'
        RETURNING id, status, public_display_name AS "publicDisplayName"
      `;
      return updated ? account(updated) : undefined;
    });
  }

  async updateDisplayName(userId: string, publicDisplayName: string) {
    const [row] = await this.sql<AccountDatabaseRow[]>`
      UPDATE contribution_users
      SET public_display_name = ${publicDisplayName}, updated_at = now()
      WHERE id = ${userId} AND status = 'active'
      RETURNING id, status, public_display_name AS "publicDisplayName"
    `;
    return row ? account(row) : undefined;
  }
}

type ReviewDatabaseRow = {
  id: string;
  revisionId: string;
  coursePrefix: string;
  courseNumber: string;
  markdown: string;
  capturedDisplayName: string;
  publishedAt: Date;
};

function publicReview(row: ReviewDatabaseRow): PublicCourseReview {
  return {
    id: row.id,
    revisionId: row.revisionId,
    coursePrefix: row.coursePrefix,
    courseNumber: row.courseNumber,
    markdown: row.markdown,
    capturedDisplayName: row.capturedDisplayName,
    publishedAt: row.publishedAt,
  };
}

export class PostgresReviewRepository implements CourseReviewRepository {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async publishCourseReview(input: PublishCourseReviewRecord) {
    const reviewId = randomUUID();
    const revisionId = randomUUID();
    try {
      const [published] = await this.sql<ReviewDatabaseRow[]>`
        SELECT review_id AS id,
               revision_id AS "revisionId",
               ${input.coursePrefix}::text AS "coursePrefix",
               ${input.courseNumber}::text AS "courseNumber",
               ${input.markdown}::text AS markdown,
               captured_display_name AS "capturedDisplayName",
               published_at AS "publishedAt"
        FROM publish_attributed_course_review(
          ${reviewId}, ${revisionId}, ${input.userId}, ${input.coursePrefix},
          ${input.courseNumber}, ${input.markdown}, ${input.policyVersion}
        )
      `;
      return publicReview(published);
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        if (
          "code" in error &&
          error.code === "23505" &&
          "constraint_name" in error &&
          error.constraint_name === "reviews_active_course_tuple_idx"
        )
          throw new ReviewWriteError(
            "duplicate-review",
            "This User already has an active Review for the Course Basis",
          );
        if ("message" in error && typeof error.message === "string") {
          const code = [
            "account-not-found",
            "onboarding-required",
            "account-suspended",
            "account-closed",
          ].find((code) => error.message === code);
          if (code)
            throw new ReviewWriteError(
              code as ReviewWriteError["code"],
              "This User cannot publish a Review",
            );
        }
      }
      throw error;
    }
  }

  async listCourseReviews(course: CourseBasis) {
    try {
      const rows = await this.sql<ReviewDatabaseRow[]>`
        SELECT r.id,
               rr.id AS "revisionId",
               rcb.course_prefix AS "coursePrefix",
               rcb.course_number AS "courseNumber",
               rr.markdown,
               rr.captured_display_name AS "capturedDisplayName",
               rr.published_at AS "publishedAt"
        FROM reviews r
        JOIN review_revisions rr ON rr.id = r.current_revision_id
        JOIN review_course_bases rcb ON rcb.revision_id = rr.id
        WHERE r.publication_state = 'active'
          AND rr.attribution = 'attributed'
          AND rcb.course_prefix = ${course.coursePrefix}
          AND rcb.course_number = ${course.courseNumber}
        ORDER BY rr.published_at DESC, r.id
      `;
      return rows.map(publicReview);
    } catch (error) {
      throw new ContributionsUnavailableError(undefined, { cause: error });
    }
  }
}

let runtime:
  | {
      sql: ReturnType<typeof postgres>;
      accounts: ReturnType<typeof createAccountService>;
      reviews: ReturnType<typeof createReviewService>;
    }
  | undefined;

function initializeRuntime() {
  if (runtime) return runtime;
  const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
  if (!connection)
    throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");
  const sql = postgres(connection, { max: 5 });
  runtime = {
    sql,
    accounts: createAccountService(new PostgresAccountRepository(sql), {
      privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION,
      communityRulesVersion: process.env.COMMUNITY_RULES_VERSION,
    }),
    reviews: createReviewService(new PostgresReviewRepository(sql), {
      reviewPolicyVersion: process.env.REVIEW_POLICY_VERSION,
      async courseExists(course) {
        const {
          getRankings,
          RankingsUnavailableError,
          UnknownRankingsEntityError,
        } = await import("@/lib/rankings/server");
        try {
          await getRankings({ type: "course", ...course });
          return true;
        } catch (error) {
          if (error instanceof UnknownRankingsEntityError) return false;
          if (error instanceof RankingsUnavailableError)
            throw new ReviewWriteError(
              "rankings-unavailable",
              "Course Basis cannot be validated while Rankings Data is unavailable",
            );
          throw error;
        }
      },
    }),
  };
  return runtime;
}

export function getAccountService() {
  return initializeRuntime().accounts;
}

export function getReviewService() {
  if (!process.env.CONTRIBUTIONS_POSTGRES_URL)
    throw new ContributionsUnavailableError();
  return initializeRuntime().reviews;
}

export async function closeAccountRuntimeForTests() {
  if (!runtime) return;
  const current = runtime;
  runtime = undefined;
  await current.sql.end();
}
