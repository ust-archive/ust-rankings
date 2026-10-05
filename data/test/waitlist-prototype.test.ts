import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { test } from "vitest";
import { extractTrajectories } from "../prototypes/waitlist-clearance.ts";
import { WAITLIST_TERMS } from "../src/waitlist-evidence.ts";

test("prototype extraction reads exact venue capacity and reports without a live queue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ust-wl-prototype-"));
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const classes = join(directory, "canonical.parquet").replaceAll("\\", "/");
  const courses = join(directory, "courses.parquet").replaceAll("\\", "/");
  const liveClasses = join(directory, "classes.parquet").replaceAll("\\", "/");
  try {
    const observations = Object.entries(WAITLIST_TERMS).flatMap(
      ([term, dates]) =>
        [
          [dates.enrollmentStart, 0],
          [
            new Date(
              Date.parse(dates.enrollmentStart) + 3_600_000,
            ).toISOString(),
            60,
          ],
          [dates.addDropEnd, 0],
        ].map(([at, wait]) => `('${term}', TIMESTAMPTZ '${at}', ${wait})`),
    );
    await connection.run(`COPY (
      SELECT term_code, "timestamp", wait, 'COMP 1000' AS course_code,
        section, 1::INTEGER AS association, 'LEC' AS type, 100 AS capacity,
        100 AS enroll, 0 AS source_order, '' AS version,
        [struct_pack(weekday := 'Mo', time_from := TIME '09:00:00',
          instructors := ['Teacher'], venue_name := venue_name, venue := venue)] AS schedules,
        []::STRUCT(enroll INTEGER, quota INTEGER)[] AS reservations
      FROM (VALUES ${observations.join(",")}) observations(term_code, "timestamp", wait)
      CROSS JOIN (VALUES ('L1', 'Lecture Theater (300)', NULL::VARCHAR),
        ('L2', 'Room (88) extra', NULL::VARCHAR),
        ('L3', NULL::VARCHAR, 'Room (150)')) venues(section, venue_name, venue)
    ) TO '${classes}' (FORMAT parquet)`);
    await connection.run(`COPY (SELECT '2610' AS term_code, 'huma' AS id,
      'HUMA' AS prefix, '1710' AS number, TIMESTAMPTZ '${WAITLIST_TERMS["2610"].addDropEnd}' AS "timestamp")
      TO '${courses}' (FORMAT parquet)`);
    await connection.run(`COPY (SELECT '2610' AS term_code, 'huma' AS course_id,
      'L1' AS section, 100 AS capacity, 100 AS enroll, 0 AS wait,
      TIMESTAMPTZ '${WAITLIST_TERMS["2610"].addDropEnd}' AS "timestamp",
      []::STRUCT(enroll INTEGER, quota INTEGER)[] AS reservations,
      []::STRUCT(instructors VARCHAR[], time_from TIME, venue_name VARCHAR, weekday VARCHAR)[] AS schedules)
      TO '${liveClasses}' (FORMAT parquet)`);

    const trajectories = await extractTrajectories(classes);
    assert.equal(trajectories.length, 12);
    for (const trajectory of trajectories) {
      const expected =
        trajectory.section === "L1"
          ? 300
          : trajectory.section === "L3"
            ? 150
            : undefined;
      assert.equal(trajectory.activationFeatures?.venueCapacity, expected);
      assert.equal(trajectory.deadlineFeatures?.venueCapacity, expected);
    }

    for (const args of [[], ["--live-demo"], ["--validate-term=2610"]]) {
      const output = join(directory, `report-${args.join("") || "default"}.md`);
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../prototypes/waitlist-clearance.ts", import.meta.url),
          ),
          ...args,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            WAITLIST_CLASSES_PATH: classes,
            WAITLIST_COURSES_PATH: courses,
            WAITLIST_SCHEDULE_CLASSES_PATH: liveClasses,
            WAITLIST_REPORT_PATH: output,
          },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = await readFile(output, "utf8");
      assert.match(report, /## Time-based model challenge/);
      assert.match(report, /## Joint Waitlist Plan demonstration/);
      assert.match(report, /## Verdict/);
      if (args.includes("--live-demo"))
        assert.match(report, /no active position-25 queue/);
      else assert.match(report, /Not requested; use --live-demo/);
      if (args.includes("--validate-term=2610"))
        assert.match(report, /held-out Term \*\*2610\*\*/);
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
    await rm(directory, { recursive: true, force: true });
  }
});
