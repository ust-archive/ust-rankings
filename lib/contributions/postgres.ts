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
import {
  createSignalService,
  EMOJI_CODES,
  type EmojiCode,
  type SignalRepository,
  type SignalSummary,
  type SignalTarget,
  SignalWriteError,
  type ThumbsState,
} from "./signals";

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

type SignalDatabaseRow = {
  thumbsUp: number;
  thumbsDown: number;
  emoji: Partial<Record<EmojiCode, number>>;
  mineThumbs: "up" | "down" | null;
  mineEmoji: EmojiCode[];
};

function signalSummary(
  row: SignalDatabaseRow,
  authenticated: boolean,
): SignalSummary {
  const emoji = Object.fromEntries(
    EMOJI_CODES.map((code) => [code, row.emoji[code] ?? 0]),
  ) as Record<EmojiCode, number>;
  return {
    thumbs: { up: row.thumbsUp, down: row.thumbsDown },
    emoji,
    ...(authenticated
      ? {
          mine: {
            thumbs: row.mineThumbs ?? "none",
            emoji: row.mineEmoji,
          },
        }
      : {}),
  };
}

function rejectSignalUser(status: string | undefined): never {
  if (!status)
    throw new SignalWriteError("account-not-found", "User was not found");
  if (status === "onboarding")
    throw new SignalWriteError(
      "onboarding-required",
      "Complete onboarding before writing",
    );
  if (status === "suspended")
    throw new SignalWriteError(
      "account-suspended",
      "This User is suspended from writing",
    );
  throw new SignalWriteError("account-closed", "This User account is closed");
}

export class PostgresSignalRepository implements SignalRepository {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async readSignals(target: SignalTarget, userId?: string) {
    try {
      const currentUser = userId ?? null;
      const [row] =
        target.type === "course"
          ? await this.sql<SignalDatabaseRow[]>`
              SELECT
                (SELECT count(*)::int FROM course_thumbs_votes
                 WHERE course_prefix = ${target.coursePrefix}
                   AND course_number = ${target.courseNumber}
                   AND state = 'up') AS "thumbsUp",
                (SELECT count(*)::int FROM course_thumbs_votes
                 WHERE course_prefix = ${target.coursePrefix}
                   AND course_number = ${target.courseNumber}
                   AND state = 'down') AS "thumbsDown",
                COALESCE((SELECT jsonb_object_agg(code, total)
                  FROM (SELECT code, count(*)::int AS total
                        FROM course_emoji_reactions
                        WHERE course_prefix = ${target.coursePrefix}
                          AND course_number = ${target.courseNumber}
                        GROUP BY code) counts), '{}'::jsonb) AS emoji,
                (SELECT state FROM course_thumbs_votes
                 WHERE user_id = ${currentUser}::uuid
                   AND course_prefix = ${target.coursePrefix}
                   AND course_number = ${target.courseNumber}) AS "mineThumbs",
                COALESCE((SELECT array_agg(code ORDER BY array_position(
                    ARRAY['love','laugh','surprised','confused','sad','angry','fire']::text[], code))
                  FROM course_emoji_reactions
                  WHERE user_id = ${currentUser}::uuid
                    AND course_prefix = ${target.coursePrefix}
                    AND course_number = ${target.courseNumber}), ARRAY[]::text[]) AS "mineEmoji"
            `
          : await this.sql<SignalDatabaseRow[]>`
              SELECT
                (SELECT count(*)::int FROM instructor_thumbs_votes
                 WHERE instructor_uuid = ${target.instructorUuid}
                   AND state = 'up') AS "thumbsUp",
                (SELECT count(*)::int FROM instructor_thumbs_votes
                 WHERE instructor_uuid = ${target.instructorUuid}
                   AND state = 'down') AS "thumbsDown",
                COALESCE((SELECT jsonb_object_agg(code, total)
                  FROM (SELECT code, count(*)::int AS total
                        FROM instructor_emoji_reactions
                        WHERE instructor_uuid = ${target.instructorUuid}
                        GROUP BY code) counts), '{}'::jsonb) AS emoji,
                (SELECT state FROM instructor_thumbs_votes
                 WHERE user_id = ${currentUser}::uuid
                   AND instructor_uuid = ${target.instructorUuid}) AS "mineThumbs",
                COALESCE((SELECT array_agg(code ORDER BY array_position(
                    ARRAY['love','laugh','surprised','confused','sad','angry','fire']::text[], code))
                  FROM instructor_emoji_reactions
                  WHERE user_id = ${currentUser}::uuid
                    AND instructor_uuid = ${target.instructorUuid}), ARRAY[]::text[]) AS "mineEmoji"
            `;
      return signalSummary(row, Boolean(userId));
    } catch (error) {
      throw new ContributionsUnavailableError(undefined, { cause: error });
    }
  }

  async setThumbs(userId: string, target: SignalTarget, state: ThumbsState) {
    let result: { status: string | null } | undefined;
    if (target.type === "course") {
      [result] =
        state === "none"
          ? await this.sql<{ status: string | null }[]>`
              WITH account AS MATERIALIZED (
                SELECT status FROM contribution_users
                WHERE id = ${userId} FOR UPDATE
              ), changed AS (
                DELETE FROM course_thumbs_votes
                WHERE user_id = ${userId}
                  AND course_prefix = ${target.coursePrefix}
                  AND course_number = ${target.courseNumber}
                  AND EXISTS (SELECT 1 FROM account WHERE status = 'active')
              )
              SELECT (SELECT status FROM account) AS status
            `
          : await this.sql<{ status: string | null }[]>`
              WITH account AS MATERIALIZED (
                SELECT status FROM contribution_users
                WHERE id = ${userId} FOR UPDATE
              ), changed AS (
                INSERT INTO course_thumbs_votes
                  (user_id, course_prefix, course_number, state)
                SELECT ${userId}, ${target.coursePrefix}, ${target.courseNumber}, ${state}
                FROM account WHERE status = 'active'
                ON CONFLICT (user_id, course_prefix, course_number)
                DO UPDATE SET state = EXCLUDED.state, updated_at = now()
              )
              SELECT (SELECT status FROM account) AS status
            `;
    } else {
      [result] =
        state === "none"
          ? await this.sql<{ status: string | null }[]>`
              WITH RECURSIVE account AS MATERIALIZED (
                SELECT status FROM contribution_users
                WHERE id = ${userId} FOR UPDATE
              ), target_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
              ), chain(uuid) AS (
                SELECT ${target.instructorUuid}::uuid FROM target_lock
                UNION
                SELECT redirects.survivor_uuid
                FROM instructor_signal_redirects redirects
                JOIN chain ON redirects.retired_uuid = chain.uuid
              ), resolved AS (
                SELECT uuid FROM chain WHERE NOT EXISTS (
                  SELECT 1 FROM instructor_signal_redirects
                  WHERE retired_uuid = chain.uuid
                ) LIMIT 1
              ), changed AS (
                DELETE FROM instructor_thumbs_votes
                WHERE user_id = ${userId}
                  AND instructor_uuid = (SELECT uuid FROM resolved)
                  AND EXISTS (SELECT 1 FROM account WHERE status = 'active')
              )
              SELECT (SELECT status FROM account) AS status
            `
          : await this.sql<{ status: string | null }[]>`
              WITH RECURSIVE account AS MATERIALIZED (
                SELECT status FROM contribution_users
                WHERE id = ${userId} FOR UPDATE
              ), target_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
              ), chain(uuid) AS (
                SELECT ${target.instructorUuid}::uuid FROM target_lock
                UNION
                SELECT redirects.survivor_uuid
                FROM instructor_signal_redirects redirects
                JOIN chain ON redirects.retired_uuid = chain.uuid
              ), resolved AS (
                SELECT uuid FROM chain WHERE NOT EXISTS (
                  SELECT 1 FROM instructor_signal_redirects
                  WHERE retired_uuid = chain.uuid
                ) LIMIT 1
              ), changed AS (
                INSERT INTO instructor_thumbs_votes
                  (user_id, instructor_uuid, state)
                SELECT ${userId}, resolved.uuid, ${state}
                FROM account CROSS JOIN resolved WHERE account.status = 'active'
                ON CONFLICT (user_id, instructor_uuid)
                DO UPDATE SET state = EXCLUDED.state, updated_at = now()
              )
              SELECT (SELECT status FROM account) AS status
            `;
    }
    if (result?.status !== "active")
      rejectSignalUser(result?.status ?? undefined);
  }

  async setEmoji(
    userId: string,
    target: SignalTarget,
    code: EmojiCode,
    selected: boolean,
  ) {
    let result: { status: string | null } | undefined;
    if (target.type === "course") {
      [result] = selected
        ? await this.sql<{ status: string | null }[]>`
            WITH account AS MATERIALIZED (
              SELECT status FROM contribution_users
              WHERE id = ${userId} FOR UPDATE
            ), changed AS (
              INSERT INTO course_emoji_reactions
                (user_id, course_prefix, course_number, code)
              SELECT ${userId}, ${target.coursePrefix}, ${target.courseNumber}, ${code}
              FROM account WHERE status = 'active'
              ON CONFLICT DO NOTHING
            )
            SELECT (SELECT status FROM account) AS status
          `
        : await this.sql<{ status: string | null }[]>`
            WITH account AS MATERIALIZED (
              SELECT status FROM contribution_users
              WHERE id = ${userId} FOR UPDATE
            ), changed AS (
              DELETE FROM course_emoji_reactions
              WHERE user_id = ${userId}
                AND course_prefix = ${target.coursePrefix}
                AND course_number = ${target.courseNumber}
                AND code = ${code}
                AND EXISTS (SELECT 1 FROM account WHERE status = 'active')
            )
            SELECT (SELECT status FROM account) AS status
          `;
    } else {
      [result] = selected
        ? await this.sql<{ status: string | null }[]>`
            WITH RECURSIVE account AS MATERIALIZED (
              SELECT status FROM contribution_users
              WHERE id = ${userId} FOR UPDATE
            ), target_lock AS MATERIALIZED (
              SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
            ), chain(uuid) AS (
              SELECT ${target.instructorUuid}::uuid FROM target_lock
              UNION
              SELECT redirects.survivor_uuid
              FROM instructor_signal_redirects redirects
              JOIN chain ON redirects.retired_uuid = chain.uuid
            ), resolved AS (
              SELECT uuid FROM chain WHERE NOT EXISTS (
                SELECT 1 FROM instructor_signal_redirects
                WHERE retired_uuid = chain.uuid
              ) LIMIT 1
            ), changed AS (
              INSERT INTO instructor_emoji_reactions
                (user_id, instructor_uuid, code)
              SELECT ${userId}, resolved.uuid, ${code}
              FROM account CROSS JOIN resolved WHERE account.status = 'active'
              ON CONFLICT DO NOTHING
            )
            SELECT (SELECT status FROM account) AS status
          `
        : await this.sql<{ status: string | null }[]>`
            WITH RECURSIVE account AS MATERIALIZED (
              SELECT status FROM contribution_users
              WHERE id = ${userId} FOR UPDATE
            ), target_lock AS MATERIALIZED (
              SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
            ), chain(uuid) AS (
              SELECT ${target.instructorUuid}::uuid FROM target_lock
              UNION
              SELECT redirects.survivor_uuid
              FROM instructor_signal_redirects redirects
              JOIN chain ON redirects.retired_uuid = chain.uuid
            ), resolved AS (
              SELECT uuid FROM chain WHERE NOT EXISTS (
                SELECT 1 FROM instructor_signal_redirects
                WHERE retired_uuid = chain.uuid
              ) LIMIT 1
            ), changed AS (
              DELETE FROM instructor_emoji_reactions
              WHERE user_id = ${userId}
                AND instructor_uuid = (SELECT uuid FROM resolved)
                AND code = ${code}
                AND EXISTS (SELECT 1 FROM account WHERE status = 'active')
            )
            SELECT (SELECT status FROM account) AS status
          `;
    }
    if (result?.status !== "active")
      rejectSignalUser(result?.status ?? undefined);
  }

  async mergeInstructorSignals(retiredUuid: string, survivorUuid: string) {
    await this.sql`
      SELECT merge_instructor_signals(${retiredUuid}, ${survivorUuid})
    `;
  }
}

let runtime:
  | {
      sql: ReturnType<typeof postgres>;
      accounts: ReturnType<typeof createAccountService>;
      reviews: ReturnType<typeof createReviewService>;
      signals: ReturnType<typeof createSignalService>;
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
    signals: createSignalService(new PostgresSignalRepository(sql), {
      async resolveTarget(target) {
        const {
          getInstructorIdentity,
          getRankings,
          RankingsUnavailableError,
          UnknownRankingsEntityError,
        } = await import("@/lib/rankings/server");
        try {
          if (target.type === "course") {
            await getRankings(target);
            return target;
          }
          const identity = await getInstructorIdentity(target.instructorUuid);
          return {
            type: "instructor" as const,
            instructorUuid: identity.instructor.uuid,
          };
        } catch (error) {
          if (error instanceof UnknownRankingsEntityError) return undefined;
          if (error instanceof RankingsUnavailableError)
            throw new SignalWriteError(
              "rankings-unavailable",
              "Signal target cannot be validated while Rankings Data is unavailable",
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

export function getSignalService() {
  if (!process.env.CONTRIBUTIONS_POSTGRES_URL)
    throw new ContributionsUnavailableError();
  return initializeRuntime().signals;
}

export async function closeAccountRuntimeForTests() {
  if (!runtime) return;
  const current = runtime;
  runtime = undefined;
  await current.sql.end();
}
