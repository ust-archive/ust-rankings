import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { writeArchiveFixture } from "./archive-fixture.ts";

export const scheduleFixtureSha = "1234567890abcdef1234567890abcdef12345678";

export type ScheduleFixtureVariant =
  | "calendar-base"
  | "calendar-inserted"
  | "calendar-reordered"
  | "calendar-updated"
  | "conflict"
  | "duplicate-event"
  | "invalid-meeting"
  | "orphan-class"
  | "same-name";

async function digest(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function makeScheduleArchiveFixture(
  directory: string,
  sourceCommit: string,
) {
  const inputs = [
    "courses.parquet",
    "classes.parquet",
    "canonical/class_records.parquet",
    "classes_legacy.parquet",
  ];
  return writeArchiveFixture(
    directory,
    sourceCommit,
    inputs,
    async ({ copy, file }) => {
      const courseColumns = `
      term_num, term_code, term_name, id, prefix, number, career, title,
      description, credits, previous, prerequisite, corequisite, exclusion,
      attributes, status, timestamp`;
      await copy(
        "courses.parquet",
        `SELECT * FROM (VALUES
        (100, '2510', '2025-26 Fall', 'c1', 'COMP', '1000', 'UGRD', 'Computing One', 'One', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'INACTIVE', TIMESTAMPTZ '2025-01-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c1', 'COMP', '1000', 'UGRD', 'Computing One', 'One', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c2', 'COMP', '2000', 'UGRD', 'Computing Two', 'Two', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c3', 'SCHED', '4000', 'UGRD', 'Schedule Only', 'Schedule', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00')
      ) AS t(${courseColumns})`,
      );
      const classColumns = `
      term_num, term_code, term_name, course_id, section, number, role, type,
      association, remarks, capacity, enroll, wait, consent, open, schedules,
      reservations, status, timestamp`;
      const alphaMeeting = `[{weekday:'Mon', date_from:NULL::DATE, date_to:NULL::DATE, time_from:NULL::TIME, time_to:NULL::TIME, venue:'R101', venue_name:'Room 101', instructors:['Alias Alpha']}]`;
      const calibratedMeeting = `[{weekday:'Tue', date_from:NULL::DATE, date_to:NULL::DATE, time_from:NULL::TIME, time_to:NULL::TIME, venue:'R102', venue_name:'Room 102', instructors:['Calibrated Name', 'Unknown Name']}]`;
      await copy(
        "classes.parquet",
        `SELECT * FROM (VALUES
        (100, '2510', '2025-26 Fall', 'c1', 'L1', 1001, 'E', 'LEC', 1, '', 40, 20, 0, false, true, ${alphaMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c2', 'L1', 1002, 'E', 'LEC', 1, '', 40, 20, 0, false, true, ${calibratedMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00')
      ) AS t(${classColumns})`,
      );
      await copy(
        "classes_legacy.parquet",
        `SELECT * FROM (VALUES
        (100, '2510', '2025-26 Fall', 'COMP 2000', 'L1', 1001, 1, 40, 20, 30, false, ${alphaMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-27T00:00:00Z', 1),
        (100, '2510', '2025-26 Fall', 'COMP 2000', 'LA1', 1003, 1, 20, 10, 12, false, ${calibratedMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-27T00:00:00Z', 2),
        (100, '2510', '2025-26 Fall', 'COMP 2000', 'L1', 1001, 1, 40, 25, 10, false, ${alphaMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-09-13T00:00:00Z', 3),
        (100, '2510', '2025-26 Fall', 'COMP 2000', 'LA1', 1003, 1, 20, 12, -1, false, ${calibratedMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-09-13T00:00:00Z', 4)
      ) AS t(term_num, term_code, term_name, course_code, section, number, association, capacity, enroll, wait, consent, schedules, reservations, timestamp, source_order)`,
      );
      await copy(
        "canonical/class_records.parquet",
        `SELECT
        'legacy'::VARCHAR AS version, NULL::VARCHAR AS source_commit,
        source_order::BIGINT AS source_order, term_num::INTEGER AS term_num,
        term_code::VARCHAR AS term_code, term_name::VARCHAR AS term_name,
        NULL::VARCHAR AS course_id,
        regexp_extract(upper(trim(course_code)), '^[A-Z]{2,8}')::VARCHAR AS prefix,
        regexp_extract(upper(trim(course_code)), '[0-9].*$')::VARCHAR AS course_number,
        upper(trim(course_code))::VARCHAR AS course_code,
        section::VARCHAR AS section, number::INTEGER AS number,
        NULL::VARCHAR AS role,
        CASE
          WHEN regexp_matches(section, '^LA', 'i') THEN 'LAB'
          WHEN regexp_matches(section, '^L', 'i') THEN 'LEC'
          WHEN regexp_matches(section, '^T', 'i') THEN 'TUT'
          ELSE 'IND'
        END::VARCHAR AS type,
        NULL::INTEGER AS association, ''::VARCHAR AS remarks,
        capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
        wait::INTEGER AS wait, consent::BOOLEAN AS consent,
        true::BOOLEAN AS open, schedules, reservations,
        'ACTIVE'::VARCHAR AS status, timestamp::TIMESTAMPTZ AS timestamp
      FROM read_parquet('${file("classes_legacy.parquet")}')`,
      );
    },
  );
}

export async function makeScheduleGeneration(
  root: string,
  malformation?: ScheduleFixtureVariant,
  sourceCommit = scheduleFixtureSha,
  includeLegacy = false,
) {
  const directory = join(root, sourceCommit);
  await mkdir(directory, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const file = (name: string) => join(directory, name).replaceAll("\\", "/");
  const copy = async (name: string, query: string) => {
    await connection.run("SET VARIABLE output_path = $path", {
      path: file(name),
    });
    await connection.run(
      `COPY (${query}) TO (getvariable('output_path')) (FORMAT parquet)`,
    );
  };

  const courses = `SELECT
    term_num::INTEGER AS term_num, term_code::VARCHAR AS term_code,
    term_name::VARCHAR AS term_name, id::VARCHAR AS id,
    prefix::VARCHAR AS prefix, number::VARCHAR AS number,
    career::VARCHAR AS career, title::VARCHAR AS title,
    description::VARCHAR AS description, credits::DOUBLE AS credits,
    previous::VARCHAR AS previous, prerequisite::VARCHAR AS prerequisite,
    corequisite::VARCHAR AS corequisite, exclusion::VARCHAR AS exclusion,
    []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[] AS attributes,
    status::VARCHAR AS status, timestamp::TIMESTAMPTZ AS timestamp
  FROM (VALUES
    (100, '2510', '2025-26 Fall', 'c1', 'COMP', '1000', 'UGRD', 'Old hidden Course', 'Old description', 3, '', '', '', '', 'ACTIVE', '2025-01-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c1', 'COMP', '1000', 'UGRD', 'Old hidden Course', 'Old description', 3, '', '', '', '', 'INACTIVE', '2025-02-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c2', 'COMP', '2000', 'UGRD', 'Original title', 'Original description', 3, '', '', '', '', 'ACTIVE', '2025-01-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c2', 'COMP', '2000', 'UGRD', 'Updated Course title', 'Bounded search description', 3, '', '', '', '', 'ACTIVE', '2025-02-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c3', 'MATH', '1000', 'UGRD', 'Mathematics', 'Numbers', 4, '', '', '', '', 'ACTIVE', '2025-01-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c5', 'WAIT', '3000', 'UGRD', 'Waitlist Fixture', 'Queue evidence', 3, '', '', '', '', 'ACTIVE', '2025-01-01T00:00:00Z'),
    (99, '2430', '2024-25 Spring', 'c4', 'COMP', '2000', 'UGRD', 'Earlier Offering', 'Earlier', 3, '', '', '', '', 'ACTIVE', '2024-01-01T00:00:00Z')
  ) t(term_num, term_code, term_name, id, prefix, number, career, title, description, credits, previous, prerequisite, corequisite, exclusion, status, timestamp)`;

  const meetingA =
    "{weekday:'Wed', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'11:00'::TIME, time_to:'11:50'::TIME, venue:'R101', venue_name:'Room 101', instructors:['Alpha Instructor']}";
  const meetingB =
    "{weekday:'Wed', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'15:00'::TIME, time_to:'15:50'::TIME, venue:'R102', venue_name:'Room 102', instructors:['Alpha Instructor']}";
  const meetingInserted =
    "{weekday:'Wed', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R103', venue_name:'Room 103', instructors:['Alpha Instructor']}";
  const meetingUpdated =
    "{weekday:'Wed', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'11:00'::TIME, time_to:'11:50'::TIME, venue:'R201', venue_name:'Room 201', instructors:['Updated Instructor']}";
  const latestSchedules =
    malformation === "calendar-base"
      ? `[${meetingA}, ${meetingB}]`
      : malformation === "calendar-reordered"
        ? `[${meetingB}, ${meetingA}]`
        : malformation === "calendar-inserted"
          ? `[${meetingA}, ${meetingInserted}, ${meetingB}]`
          : malformation === "calendar-updated"
            ? `[${meetingUpdated}, ${meetingB}]`
            : malformation === "invalid-meeting"
              ? "[{weekday:'Invalid', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'11:00'::TIME, time_to:'11:50'::TIME, venue:'R101', venue_name:'Room 101', instructors:['Alpha Instructor']}]"
              : `[${meetingA}]`;

  const classes = `SELECT
    term_num::INTEGER AS term_num, term_code::VARCHAR AS term_code,
    term_name::VARCHAR AS term_name, course_id::VARCHAR AS course_id,
    section::VARCHAR AS section, number::INTEGER AS number,
    role::VARCHAR AS role, type::VARCHAR AS type,
    association::INTEGER AS association, remarks::VARCHAR AS remarks,
    capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
    wait::INTEGER AS wait, consent::BOOLEAN AS consent, open::BOOLEAN AS open,
    schedules::STRUCT(weekday VARCHAR, date_from DATE, date_to DATE, time_from TIME, time_to TIME, venue VARCHAR, venue_name VARCHAR, instructors VARCHAR[])[] AS schedules,
    CASE
      WHEN course_id = 'c2' AND section = 'L1' AND timestamp = TIMESTAMPTZ '2025-02-01T00:00:00Z'
      THEN [{'name':'COMP majors', 'quota':40, 'enroll':20}]
      ELSE []
    END::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[] AS reservations,
    status::VARCHAR AS status, timestamp::TIMESTAMPTZ AS timestamp
  FROM (VALUES
    (100, '2510', '2025-26 Fall', 'c1', 'L1', 999, 'E', 'LEC', 1, '', 10, 5, 0, false, true, [{weekday:'Mon', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'09:00'::TIME, time_to:'09:50'::TIME, venue:'OLD', venue_name:'Old Room', instructors:['Old Instructor']}], 'ACTIVE', '2025-01-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c2', 'L1', 1001, 'E', 'LEC', 1, '', 80, 20, 0, false, true, [{weekday:'Tue', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'10:00'::TIME, time_to:'10:50'::TIME, venue:'R101', venue_name:'Room 101', instructors:['Alpha Instructor']}], 'ACTIVE', '2025-01-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c2', 'L1', 1001, 'E', 'LEC', 1, 'Bring a laptop', 80, 30, -1, false, true, ${latestSchedules}, 'ACTIVE', '2025-02-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c2', 'T1', 1002, 'N', 'TUT', 1, '', 20, 10, 0, false, true, [], 'ACTIVE', '2025-01-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c2', 'T1', 1002, 'N', 'TUT', 1, '', 20, 10, 0, false, false, [], 'INACTIVE', '2025-02-01T00:00:00Z'),
    (100, '2510', '2025-26 Fall', '${malformation === "orphan-class" ? "missing" : "c3"}', 'L1', 2001, 'E', 'LEC', 1, '', 60, 40, 5, false, true, [{weekday:'${malformation === "conflict" ? "Wed" : "Fri"}', date_from:${malformation === "conflict" ? "'2025-09-01'" : "NULL"}::DATE, date_to:${malformation === "conflict" ? "'2025-11-30'" : "NULL"}::DATE, time_from:'${malformation === "conflict" ? "11:30" : "13:00"}'::TIME, time_to:'${malformation === "conflict" ? "12:20" : "13:50"}'::TIME, venue:'R202', venue_name:'Room 202', instructors:${malformation === "same-name" ? "['Alpha Instructor']" : "[' ', ' TBA ', ' Unresolved Teacher ']"}}], 'ACTIVE', '2025-08-27T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c3', 'T1', 2002, 'N', 'TUT', 1, '', 20, 15, 3, false, true, [], 'ACTIVE', '2025-08-27T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c5', 'L1', 5001, 'E', 'LEC', 1, '', 40, 20, 12, false, false, [{weekday:'Mon', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], 'ACTIVE', '2025-08-26T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c5', 'L1', 5001, 'E', 'LEC', 1, '', 40, 30, 8, false, false, [{weekday:'Mon', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], 'ACTIVE', '2025-08-28T00:00:00Z'),
    (100, '2510', '2025-26 Fall', 'c5', 'T1', 5002, 'N', 'TUT', 1, '', 20, 15, 4, false, true, [{weekday:'Tue', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], 'ACTIVE', '2025-08-28T00:00:00Z'),
    (99, '2430', '2024-25 Spring', 'c4', 'L1', 3001, 'E', 'LEC', 1, '', 60, 40, 0, false, true, [], 'ACTIVE', '2024-01-01T00:00:00Z')
  ) t(term_num, term_code, term_name, course_id, section, number, role, type, association, remarks, capacity, enroll, wait, consent, open, schedules, status, timestamp)`;

  try {
    await copy("courses.parquet", courses);
    await copy("classes.parquet", classes);
    if (malformation === "duplicate-event") {
      await connection.run("SET VARIABLE duplicate_path = $path", {
        path: file("courses.parquet"),
      });
      await connection.run(
        "CREATE TABLE duplicated AS SELECT * FROM read_parquet(getvariable('duplicate_path')); INSERT INTO duplicated SELECT * FROM duplicated LIMIT 1; COPY duplicated TO (getvariable('duplicate_path')) (FORMAT parquet, OVERWRITE true)",
      );
    }

    if (includeLegacy) {
      await copy(
        "classes_legacy.parquet",
        `SELECT * REPLACE (replace(course_code, ' ', '') AS course_code) FROM (SELECT * FROM (VALUES
        (100, '2510', '2025-26 Fall', 'WAIT 3000', 'L1', 5001, 1, 40, 20, 12, false, [{weekday:'Mon', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-27T00:00:00Z', 1),
        (100, '2510', '2025-26 Fall', 'WAIT 3000', 'T1', 5002, 1, 20, 10, 8, false, [{weekday:'Tue', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-27T00:00:00Z', 2),
        (100, '2510', '2025-26 Fall', 'WAIT 3000', 'L1', 5001, 1, 40, 30, 8, false, [{weekday:'Mon', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-28T00:00:00Z', 3),
        (100, '2510', '2025-26 Fall', 'WAIT 3000', 'T1', 5002, 1, 20, 15, 4, false, [{weekday:'Tue', date_from:'2025-09-01'::DATE, date_to:'2025-11-30'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-28T00:00:00Z', 4),
        (99, '2430', '2024-25 Spring', 'WAIT 3000', 'L1', 5001, 1, 40, 20, 10, false, [{weekday:'Mon', date_from:'2025-01-27'::DATE, date_to:'2025-02-14'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-01-27T00:00:00Z', 5),
        (99, '2430', '2024-25 Spring', 'WAIT 3000', 'T1', 5002, 1, 20, 10, 3, false, [{weekday:'Tue', date_from:'2025-01-27'::DATE, date_to:'2025-02-14'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-02-14T00:00:00Z', 6),
        (99, '2430', '2024-25 Spring', 'WAIT 3000', 'L1', 5001, 1, 40, 25, 2, false, [{weekday:'Mon', date_from:'2025-01-27'::DATE, date_to:'2025-02-14'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-02-14T00:00:00Z', 7),
        (99, '2430', '2024-25 Spring', 'WAIT 3000', 'T1', 5002, 1, 20, 15, 1, false, [{weekday:'Tue', date_from:'2025-01-27'::DATE, date_to:'2025-02-14'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-02-14T00:00:00Z', 8),
        (98, '2410', '2024-25 Fall', 'WAIT 3000', 'L1', 5001, 1, 40, 20, 10, false, [{weekday:'Mon', date_from:'2024-09-01'::DATE, date_to:'2024-11-30'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2024-08-27T00:00:00Z', 9),
        (98, '2410', '2024-25 Fall', 'WAIT 3000', 'T1', 5002, 1, 20, 10, 3, false, [{weekday:'Tue', date_from:'2024-09-01'::DATE, date_to:'2024-11-30'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2024-08-27T00:00:00Z', 10),
        (98, '2410', '2024-25 Fall', 'WAIT 3000', 'L1', 5001, 1, 40, 20, 0, false, [{weekday:'Mon', date_from:'2024-09-01'::DATE, date_to:'2024-11-30'::DATE, time_from:'16:00'::TIME, time_to:'16:50'::TIME, venue:'R301', venue_name:'Room 301 (60)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2024-09-14T00:00:00Z', 11),
        (98, '2410', '2024-25 Fall', 'WAIT 3000', 'T1', 5002, 1, 20, 10, 1, false, [{weekday:'Tue', date_from:'2024-09-01'::DATE, date_to:'2024-11-30'::DATE, time_from:'17:00'::TIME, time_to:'17:50'::TIME, venue:'R302', venue_name:'Room 302 (30)', instructors:['Queue Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2024-09-14T00:00:00Z', 12),
        (100, '2510', '2025-26 Fall', 'MATH 1000', 'L1', 2001, 1, 60, 35, 10, false, [{weekday:'Fri', date_from:NULL::DATE, date_to:NULL::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R202', venue_name:'Room 202', instructors:['Math Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-27T00:00:00Z', 13),
        (100, '2510', '2025-26 Fall', 'MATH 1000', 'L1', 2001, 1, 60, 40, 5, false, [{weekday:'Fri', date_from:NULL::DATE, date_to:NULL::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R202', venue_name:'Room 202', instructors:['Math Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-08-28T00:00:00Z', 14),
        (99, '2430', '2024-25 Spring', 'MATH 1000', 'L1', 2001, 1, 60, 35, 8, false, [{weekday:'Fri', date_from:NULL::DATE, date_to:NULL::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R202', venue_name:'Room 202', instructors:['Math Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-01-27T00:00:00Z', 15),
        (99, '2430', '2024-25 Spring', 'MATH 1000', 'L1', 2001, 1, 60, 42, 0, false, [{weekday:'Fri', date_from:NULL::DATE, date_to:NULL::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R202', venue_name:'Room 202', instructors:['Math Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2025-02-14T00:00:00Z', 16),
        (98, '2410', '2024-25 Fall', 'MATH 1000', 'L1', 2001, 1, 60, 35, 7, false, [{weekday:'Fri', date_from:NULL::DATE, date_to:NULL::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R202', venue_name:'Room 202', instructors:['Math Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2024-08-27T00:00:00Z', 17),
        (98, '2410', '2024-25 Fall', 'MATH 1000', 'L1', 2001, 1, 60, 41, 0, false, [{weekday:'Fri', date_from:NULL::DATE, date_to:NULL::DATE, time_from:'13:00'::TIME, time_to:'13:50'::TIME, venue:'R202', venue_name:'Room 202', instructors:['Math Instructor']}], []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], TIMESTAMPTZ '2024-09-14T00:00:00Z', 18)
      ) AS t(term_num, term_code, term_name, course_code, section, number, association, capacity, enroll, wait, consent, schedules, reservations, timestamp, source_order))`,
      );
      await mkdir(join(directory, "canonical"), { recursive: true });
      await copy(
        "canonical/class_records.parquet",
        `SELECT
          'canonical'::VARCHAR AS version, NULL::VARCHAR AS source_commit,
          source_order::BIGINT AS source_order, term_num::INTEGER AS term_num,
          term_code::VARCHAR AS term_code, term_name::VARCHAR AS term_name,
          NULL::VARCHAR AS course_id,
          regexp_extract(upper(trim(course_code)), '^[A-Z]+')::VARCHAR AS prefix,
          regexp_extract(upper(trim(course_code)), '[0-9].*$')::VARCHAR AS course_number,
          regexp_extract(upper(trim(course_code)), '^[A-Z]+') || ' ' ||
            regexp_extract(upper(trim(course_code)), '[0-9].*$') AS course_code,
          section::VARCHAR AS section, number::INTEGER AS number,
          NULL::VARCHAR AS role,
          CASE
            WHEN regexp_matches(section, '^LA', 'i') THEN 'LAB'
            WHEN regexp_matches(section, '^L', 'i') THEN 'LEC'
            WHEN regexp_matches(section, '^T', 'i') THEN 'TUT'
            ELSE 'IND'
          END::VARCHAR AS type,
          association::INTEGER AS association, ''::VARCHAR AS remarks,
          capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
          wait::INTEGER AS wait, consent::BOOLEAN AS consent,
          true::BOOLEAN AS open, schedules, reservations,
          'ACTIVE'::VARCHAR AS status, timestamp::TIMESTAMPTZ AS timestamp
        FROM read_parquet('${file("classes_legacy.parquet")}')`,
      );
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  const filenames = includeLegacy
    ? [
        "courses.parquet",
        "classes.parquet",
        "canonical/class_records.parquet",
        "classes_legacy.parquet",
      ]
    : ["courses.parquet", "classes.parquet"];
  const artifacts = Object.fromEntries(
    await Promise.all(
      filenames.map(async (name) => [
        name,
        {
          sha256: await digest(join(directory, name)),
          size: (await stat(join(directory, name))).size,
        },
      ]),
    ),
  );
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ schemaMajor: 0, sourceCommit, artifacts }, null, 2)}\n`,
  );
  return directory;
}
