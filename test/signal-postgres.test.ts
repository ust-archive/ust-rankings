import { expect, mock, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createSignalService, EMOJI_CODES } from "@/lib/contributions/signals";
import { makeRankingGeneration } from "./rankings-fixture";

mock.module("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const COURSE = {
  type: "course" as const,
  coursePrefix: "COMP",
  courseNumber: "2000",
};
const SURVIVOR = "00000000-0000-4000-8000-000000000001";
const RETIRED = "00000000-0000-4000-8000-000000000002";
const SPLIT = "00000000-0000-4000-8000-00000000000a";

if (!connection) {
  test.skip("Signal PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Signal PostgreSQL contract enforces desired states, privacy, concurrency, authorization, and Instructor identity rules", async () => {
    const schema = `signal_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = postgres(connection, {
      max: 12,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    const rankingRoot = await mkdtemp(join(tmpdir(), "signal-rankings-"));
    process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(rankingRoot);
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
      const { PostgresSignalRepository } = await import(
        "@/lib/contributions/postgres"
      );
      const repository = new PostgresSignalRepository(sql);
      const signals = createSignalService(repository, {
        async resolveTarget(target) {
          return target;
        },
      });
      const { queryRankings } = await import("@/lib/rankings/server");
      const rankingBeforeSignals = await queryRankings({
        entity: "course",
        termCode: "2510",
      });
      const activeId = crypto.randomUUID();
      const otherId = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${activeId}, 'active', 'Signal Student'),
               (${otherId}, 'active', 'Other Student')
      `;

      for (const state of ["up", "up", "down", "none", "none", "up"] as const)
        await signals.setThumbs(activeId, { target: COURSE, state });
      await signals.setThumbs(otherId, { target: COURSE, state: "down" });
      for (const code of EMOJI_CODES) {
        await signals.setEmoji(activeId, {
          target: COURSE,
          code,
          selected: true,
        });
        await signals.setEmoji(activeId, {
          target: COURSE,
          code,
          selected: true,
        });
      }
      await signals.setEmoji(activeId, {
        target: COURSE,
        code: "sad",
        selected: false,
      });
      await signals.setEmoji(activeId, {
        target: COURSE,
        code: "sad",
        selected: false,
      });

      const publicSummary = await signals.readSignals(COURSE);
      expect(publicSummary).toEqual({
        thumbs: { up: 1, down: 1 },
        emoji: {
          love: 1,
          laugh: 1,
          surprised: 1,
          confused: 1,
          sad: 0,
          angry: 1,
          fire: 1,
        },
      });
      expect(JSON.stringify(publicSummary)).not.toContain(activeId);
      expect(await signals.readSignals(COURSE, activeId)).toEqual({
        ...publicSummary,
        mine: {
          thumbs: "up",
          emoji: ["love", "laugh", "surprised", "confused", "angry", "fire"],
        },
      });
      expect(await signals.readSignals(COURSE, otherId)).toEqual({
        ...publicSummary,
        mine: { thumbs: "down", emoji: [] },
      });

      for (const status of ["onboarding", "suspended", "closed"] as const) {
        const userId = crypto.randomUUID();
        await sql`
          INSERT INTO contribution_users (id, status, public_display_name)
          VALUES (${userId}, ${status}, 'Blocked Student')
        `;
        let blockedError: unknown;
        try {
          await signals.setThumbs(userId, { target: COURSE, state: "up" });
        } catch (error) {
          blockedError = error;
        }
        expect(blockedError).toMatchObject({
          code:
            status === "onboarding"
              ? "onboarding-required"
              : status === "suspended"
                ? "account-suspended"
                : "account-closed",
        });
      }
      let missingError: unknown;
      try {
        await signals.setThumbs(crypto.randomUUID(), {
          target: COURSE,
          state: "up",
        });
      } catch (error) {
        missingError = error;
      }
      expect(missingError).toMatchObject({ code: "account-not-found" });

      let emojiConstraintError: unknown;
      try {
        await sql`
          INSERT INTO course_emoji_reactions
            (user_id, course_prefix, course_number, code)
          VALUES (${activeId}, 'COMP', '2000', 'thumbs-up')
        `;
      } catch (error) {
        emojiConstraintError = error;
      }
      expect(emojiConstraintError).toMatchObject({ code: "23514" });
      let thumbsConstraintError: unknown;
      try {
        await sql`
          INSERT INTO course_thumbs_votes
            (user_id, course_prefix, course_number, state)
          VALUES (${activeId}, 'COMP', '2000', 'down')
        `;
      } catch (error) {
        thumbsConstraintError = error;
      }
      expect(thumbsConstraintError).toMatchObject({ code: "23505" });

      const concurrentIds = Array.from({ length: 12 }, () =>
        crypto.randomUUID(),
      );
      await sql`
        INSERT INTO contribution_users ${sql(
          concurrentIds.map((id) => ({
            id,
            status: "active",
            public_display_name: "Concurrent Student",
          })),
        )}
      `;
      await Promise.all(
        concurrentIds.flatMap((userId) => [
          signals.setThumbs(userId, { target: COURSE, state: "up" }),
          signals.setEmoji(userId, {
            target: COURSE,
            code: "fire",
            selected: true,
          }),
        ]),
      );
      expect(await signals.readSignals(COURSE)).toMatchObject({
        thumbs: { up: 13, down: 1 },
        emoji: { fire: 13 },
      });

      await signals.setThumbs(activeId, {
        target: { type: "instructor", instructorUuid: RETIRED },
        state: "up",
      });
      await signals.setThumbs(activeId, {
        target: { type: "instructor", instructorUuid: SURVIVOR },
        state: "down",
      });
      await signals.setThumbs(otherId, {
        target: { type: "instructor", instructorUuid: RETIRED },
        state: "down",
      });
      await signals.setThumbs(otherId, {
        target: { type: "instructor", instructorUuid: SURVIVOR },
        state: "up",
      });
      await sql`
        UPDATE instructor_thumbs_votes
        SET updated_at = CASE
          WHEN user_id = ${activeId} AND instructor_uuid = ${RETIRED} THEN '2026-08-20T12:03:00Z'::timestamptz
          WHEN user_id = ${activeId} THEN '2026-08-20T12:02:00Z'::timestamptz
          WHEN instructor_uuid = ${RETIRED} THEN '2026-08-20T12:01:00Z'::timestamptz
          ELSE '2026-08-20T12:04:00Z'::timestamptz
        END
      `;
      for (const instructorUuid of [RETIRED, SURVIVOR])
        await signals.setEmoji(activeId, {
          target: { type: "instructor", instructorUuid },
          code: "love",
          selected: true,
        });
      await signals.setEmoji(activeId, {
        target: { type: "instructor", instructorUuid: RETIRED },
        code: "fire",
        selected: true,
      });
      await signals.setEmoji(otherId, {
        target: { type: "instructor", instructorUuid: SPLIT },
        code: "confused",
        selected: true,
      });

      await signals.mergeInstructorSignals(RETIRED, SURVIVOR);
      await signals.mergeInstructorSignals(RETIRED, SURVIVOR);
      expect(
        await signals.readSignals(
          { type: "instructor", instructorUuid: SURVIVOR },
          activeId,
        ),
      ).toMatchObject({
        thumbs: { up: 2, down: 0 },
        emoji: { love: 1, fire: 1 },
        mine: { thumbs: "up", emoji: ["love", "fire"] },
      });
      expect(
        await signals.readSignals({
          type: "instructor",
          instructorUuid: RETIRED,
        }),
      ).toMatchObject({
        thumbs: { up: 0, down: 0 },
        emoji: { love: 0, fire: 0 },
      });

      // A write that resolved the retired UUID before the merge still follows
      // the durable database redirect and cannot recreate retired signals.
      await repository.setThumbs(
        activeId,
        {
          type: "instructor",
          instructorUuid: RETIRED,
        },
        "down",
      );
      expect(
        await signals.readSignals(
          { type: "instructor", instructorUuid: SURVIVOR },
          activeId,
        ),
      ).toMatchObject({
        thumbs: { up: 1, down: 1 },
        mine: { thumbs: "down" },
      });
      const [retiredRows] = await sql<{ count: number }[]>`
        SELECT (
          (SELECT count(*) FROM instructor_thumbs_votes WHERE instructor_uuid = ${RETIRED}) +
          (SELECT count(*) FROM instructor_emoji_reactions WHERE instructor_uuid = ${RETIRED})
        )::int AS count
      `;
      expect(retiredRows?.count).toBe(0);

      // Instructor splits do not invoke merge and retain signals on the source UUID.
      expect(
        await signals.readSignals(
          { type: "instructor", instructorUuid: SPLIT },
          otherId,
        ),
      ).toMatchObject({
        emoji: { confused: 1 },
        mine: { emoji: ["confused"] },
      });
      expect(
        await queryRankings({ entity: "course", termCode: "2510" }),
      ).toEqual(rankingBeforeSignals);
    } finally {
      await sql.end({ timeout: 1 });
      const cleanup = postgres(connection, { max: 1, onnotice: () => {} });
      await cleanup.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await cleanup.end();
      delete process.env.RANKINGS_SEED_DIR;
      const { resetRankingsRuntimeForTests } = await import(
        "@/lib/rankings/server"
      );
      await resetRankingsRuntimeForTests();
      await rm(rankingRoot, { recursive: true, force: true });
    }
  }, 30_000);
}
