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
  resolveReviewInstructorAssociationStatus,
  validateReviewAssociations,
} from "./review-associations";
import {
  ContributionsUnavailableError,
  createReviewService,
  type EditReviewRecord,
  type PublicReview,
  type PublishReviewRecord,
  type ReviewListQuery,
  type ReviewRepository,
  ReviewWriteError,
  type WithdrawReviewRecord,
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
  coursePrefix: string | null;
  courseNumber: string | null;
  instructorUuid: string | null;
  termCode: string | null;
  section: string | null;
  markdown: string;
  attribution: "attributed" | "identity-hidden";
  capturedDisplayName: string | null;
  publishedAt: Date;
  viewerCanEdit?: boolean;
  instructorAssociationStatus:
    | PublicReview["instructorAssociationStatus"]
    | null;
};

function publicReview(row: ReviewDatabaseRow): PublicReview {
  return {
    id: row.id,
    revisionId: row.revisionId,
    ...(row.coursePrefix && row.courseNumber
      ? {
          course: {
            coursePrefix: row.coursePrefix,
            courseNumber: row.courseNumber,
          },
        }
      : {}),
    ...(row.instructorUuid ? { instructorUuid: row.instructorUuid } : {}),
    ...(row.termCode ? { termCode: row.termCode } : {}),
    ...(row.section ? { section: row.section } : {}),
    markdown: row.markdown,
    attribution: row.attribution,
    attributionCredit:
      row.attribution === "attributed"
        ? (row.capturedDisplayName as string)
        : "UST Rankings contributor",
    ...(row.capturedDisplayName
      ? { capturedDisplayName: row.capturedDisplayName }
      : {}),
    license: "CC BY 4.0",
    publishedAt: row.publishedAt,
    ...(row.viewerCanEdit ? { viewerCanEdit: true } : {}),
    ...(row.instructorAssociationStatus
      ? { instructorAssociationStatus: row.instructorAssociationStatus }
      : {}),
  };
}

function mapReviewWriteError(error: unknown): never {
  if (typeof error === "object" && error !== null) {
    if (
      "code" in error &&
      error.code === "23505" &&
      "constraint_name" in error &&
      error.constraint_name === "reviews_active_association_tuple_idx"
    )
      throw new ReviewWriteError(
        "duplicate-review",
        "This User already has an active Review for this exact Review Basis and Review Context tuple",
      );
    if ("message" in error && typeof error.message === "string") {
      const code = [
        "account-not-found",
        "onboarding-required",
        "account-suspended",
        "account-closed",
        "review-not-found",
        "wrong-owner",
        "stale-review",
        "review-withdrawn",
      ].find((code) => error.message === code);
      if (code)
        throw new ReviewWriteError(
          code as ReviewWriteError["code"],
          "This User cannot change this Review",
        );
    }
  }
  throw error;
}

export class PostgresReviewRepository implements ReviewRepository {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async publishReview(input: PublishReviewRecord) {
    const reviewId = randomUUID();
    const revisionId = randomUUID();
    const { course, instructorUuid, termCode, section } = input.associations;
    try {
      const [published] = await this.sql<ReviewDatabaseRow[]>`
        SELECT review_id AS id,
               revision_id AS "revisionId",
               ${course?.coursePrefix ?? null}::text AS "coursePrefix",
               ${course?.courseNumber ?? null}::text AS "courseNumber",
               ${instructorUuid ?? null}::uuid AS "instructorUuid",
               ${termCode ?? null}::text AS "termCode",
               ${section ?? null}::text AS section,
               ${input.markdown}::text AS markdown,
               attribution,
               captured_display_name AS "capturedDisplayName",
               published_at AS "publishedAt",
               ${instructorUuid ? "resolved" : null}::text AS "instructorAssociationStatus"
        FROM publish_review(
          ${reviewId}, ${revisionId}, ${input.userId},
          ${course?.coursePrefix ?? null}, ${course?.courseNumber ?? null},
          ${instructorUuid ?? null}, ${termCode ?? null}, ${section ?? null},
          ${input.markdown}, ${input.attribution}, ${input.policyVersion}
        )
      `;
      return publicReview(published);
    } catch (error) {
      mapReviewWriteError(error);
    }
  }

  async editReview(input: EditReviewRecord) {
    const revisionId = randomUUID();
    const { course, instructorUuid, termCode, section } = input.associations;
    try {
      const [edited] = await this.sql<ReviewDatabaseRow[]>`
        SELECT review_id AS id,
               revision_id AS "revisionId",
               ${course?.coursePrefix ?? null}::text AS "coursePrefix",
               ${course?.courseNumber ?? null}::text AS "courseNumber",
               ${instructorUuid ?? null}::uuid AS "instructorUuid",
               ${termCode ?? null}::text AS "termCode",
               ${section ?? null}::text AS section,
               ${input.markdown}::text AS markdown,
               attribution,
               captured_display_name AS "capturedDisplayName",
               published_at AS "publishedAt",
               ${instructorUuid ? "resolved" : null}::text AS "instructorAssociationStatus",
               true AS "viewerCanEdit"
        FROM edit_review(
          ${input.reviewId}, ${revisionId}, ${input.expectedRevisionId},
          ${input.userId}, ${course?.coursePrefix ?? null},
          ${course?.courseNumber ?? null}, ${instructorUuid ?? null},
          ${termCode ?? null}, ${section ?? null}, ${input.markdown},
          ${input.attribution}, ${input.policyVersion}
        )
      `;
      return publicReview(edited);
    } catch (error) {
      mapReviewWriteError(error);
    }
  }

  async withdrawReview(input: WithdrawReviewRecord) {
    try {
      await this.sql`
        SELECT withdraw_review(
          ${input.reviewId}, ${input.expectedRevisionId}, ${input.userId}
        )
      `;
    } catch (error) {
      mapReviewWriteError(error);
    }
  }

  async getReview(reviewId: string, viewerUserId?: string) {
    try {
      const [row] = await this.sql<ReviewDatabaseRow[]>`
        SELECT r.id,
               rr.id AS "revisionId",
               rcb.course_prefix AS "coursePrefix",
               rcb.course_number AS "courseNumber",
               rib.instructor_uuid AS "instructorUuid",
               rc.term_code AS "termCode",
               rc.section,
               rr.markdown,
               rr.attribution,
               rr.captured_display_name AS "capturedDisplayName",
               rr.published_at AS "publishedAt",
               r.instructor_association_status AS "instructorAssociationStatus",
               (${viewerUserId ?? null}::uuid IS NOT NULL
                 AND r.author_user_id = ${viewerUserId ?? null}::uuid) AS "viewerCanEdit"
        FROM reviews r
        JOIN review_revisions rr ON rr.id = r.current_revision_id
        LEFT JOIN review_course_bases rcb ON rcb.revision_id = rr.id
        LEFT JOIN review_instructor_bases rib ON rib.revision_id = rr.id
        LEFT JOIN review_contexts rc ON rc.revision_id = rr.id
        WHERE r.id = ${reviewId} AND r.publication_state = 'active'
      `;
      return row ? publicReview(row) : undefined;
    } catch (error) {
      throw new ContributionsUnavailableError(undefined, { cause: error });
    }
  }

  async listReviews(query: ReviewListQuery, viewerUserId?: string) {
    try {
      const rows = await this.sql<ReviewDatabaseRow[]>`
        SELECT r.id,
               rr.id AS "revisionId",
               rcb.course_prefix AS "coursePrefix",
               rcb.course_number AS "courseNumber",
               rib.instructor_uuid AS "instructorUuid",
               rc.term_code AS "termCode",
               rc.section,
               rr.markdown,
               rr.attribution,
               rr.captured_display_name AS "capturedDisplayName",
               rr.published_at AS "publishedAt",
               r.instructor_association_status AS "instructorAssociationStatus",
               (${viewerUserId ?? null}::uuid IS NOT NULL
                 AND r.author_user_id = ${viewerUserId ?? null}::uuid) AS "viewerCanEdit"
        FROM reviews r
        JOIN review_revisions rr ON rr.id = r.current_revision_id
        LEFT JOIN review_course_bases rcb ON rcb.revision_id = rr.id
        LEFT JOIN review_instructor_bases rib ON rib.revision_id = rr.id
        LEFT JOIN review_contexts rc ON rc.revision_id = rr.id
        WHERE r.publication_state = 'active'
          AND (${query.type} = 'course' AND rcb.course_prefix = ${query.type === "course" ? query.coursePrefix : null}
               AND rcb.course_number = ${query.type === "course" ? query.courseNumber : null}
            OR ${query.type} = 'instructor' AND rib.instructor_uuid = ANY(${query.type === "instructor" ? query.instructorUuids : []}::uuid[]))
          AND (${query.termCode ?? null}::text IS NULL OR rc.term_code = ${query.termCode ?? null})
          AND (${query.type === "course" ? (query.section ?? null) : null}::text IS NULL
               OR rc.section = ${query.type === "course" ? (query.section ?? null) : null})
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
              ), graph_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock_shared(1431520338, 47)
              ), target_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
                FROM graph_lock
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
              ), graph_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock_shared(1431520338, 47)
              ), target_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
                FROM graph_lock
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
            ), graph_lock AS MATERIALIZED (
              SELECT pg_advisory_xact_lock_shared(1431520338, 47)
            ), target_lock AS MATERIALIZED (
              SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
              FROM graph_lock
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
            ), graph_lock AS MATERIALIZED (
              SELECT pg_advisory_xact_lock_shared(1431520338, 47)
            ), target_lock AS MATERIALIZED (
              SELECT pg_advisory_xact_lock(hashtextextended(${target.instructorUuid}, 47))
              FROM graph_lock
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
      validateAssociations: validateReviewAssociations,
      resolveInstructorAssociationStatus:
        resolveReviewInstructorAssociationStatus,
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
