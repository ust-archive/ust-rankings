import type { ServerIndex } from "@/lib/server-index-contract";

export const SERVER_INDEX_GENERATION = "a".repeat(64);
export const NEXT_SERVER_INDEX_GENERATION = "b".repeat(64);
export const SERVER_INDEX_SOURCE_COMMIT = "1".repeat(40);
export const SERVER_INDEX_SPLIT_COMMIT = "2".repeat(40);
export const ALPHA_INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000001";
export const RETIRED_INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000002";
export const SPLIT_INSTRUCTOR_UUID = "00000000-0000-4000-8000-000000000003";

export function serverIndexFixture(
  generation = SERVER_INDEX_GENERATION,
): ServerIndex {
  return {
    schemaVersion: 1,
    generation,
    courses: [
      { prefix: "COMP", number: "2000" },
      { prefix: "LANG", number: "FR1" },
      { prefix: "MATH", number: "1000" },
    ],
    instructors: [
      {
        uuid: ALPHA_INSTRUCTOR_UUID,
        canonicalName: "Alpha Instructor",
        itsc: "alpha",
      },
      {
        uuid: RETIRED_INSTRUCTOR_UUID,
        canonicalName: "Retired Instructor",
      },
      {
        uuid: SPLIT_INSTRUCTOR_UUID,
        canonicalName: "Split Instructor",
      },
    ],
    instructorAliases: [
      {
        uuid: ALPHA_INSTRUCTOR_UUID,
        name: "Alpha Instructor",
        source: "schedule",
        sourceCommit: SERVER_INDEX_SOURCE_COMMIT,
      },
      {
        uuid: RETIRED_INSTRUCTOR_UUID,
        name: "Retired Instructor",
        source: "ranking-generation",
        sourceCommit: SERVER_INDEX_SOURCE_COMMIT,
      },
      {
        uuid: SPLIT_INSTRUCTOR_UUID,
        name: "Split Instructor",
        source: "schedule",
        sourceCommit: SERVER_INDEX_SPLIT_COMMIT,
      },
    ],
    instructorIdentityEvents: [
      {
        type: "merge",
        retiredUuid: RETIRED_INSTRUCTOR_UUID,
        survivorUuid: ALPHA_INSTRUCTOR_UUID,
        sourceCommit: SERVER_INDEX_SOURCE_COMMIT,
      },
      {
        type: "split",
        sourceUuid: ALPHA_INSTRUCTOR_UUID,
        newUuid: SPLIT_INSTRUCTOR_UUID,
        sourceCommit: SERVER_INDEX_SPLIT_COMMIT,
      },
    ],
    instructorRedirects: [
      { from: RETIRED_INSTRUCTOR_UUID, to: ALPHA_INSTRUCTOR_UUID },
    ],
    associationCorrections: [
      {
        correctionType: "split",
        sourceCommit: SERVER_INDEX_SPLIT_COMMIT,
        targetUuid: SPLIT_INSTRUCTOR_UUID,
        sourceName: "Split Instructor",
        termCode: "2510",
        courseCode: "COMP 2000",
      },
    ],
    relations: [
      {
        uuid: ALPHA_INSTRUCTOR_UUID,
        termNumber: 100,
        termCode: "2510",
        courseCode: "COMP 2000",
      },
      {
        uuid: SPLIT_INSTRUCTOR_UUID,
        termNumber: 100,
        termCode: "2510",
        courseCode: "MATH 1000",
      },
    ],
    courseOfferings: [
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "comp-2000",
        courseCode: "COMP 2000",
      },
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "math-1000",
        courseCode: "MATH 1000",
      },
    ],
    classes: [
      {
        termNumber: 100,
        termCode: "2510",
        courseId: "comp-2000",
        section: "L1",
        classNumber: 1001,
        courseCode: "COMP 2000",
      },
      {
        termNumber: 100,
        termCode: "2510",
        courseId: "math-1000",
        section: "L1",
        classNumber: 2001,
        courseCode: "MATH 1000",
      },
    ],
    classInstructors: [
      {
        termCode: "2510",
        courseId: "comp-2000",
        section: "L1",
        classNumber: 1001,
        uuid: ALPHA_INSTRUCTOR_UUID,
        sourceName: "Alpha Instructor",
      },
      {
        termCode: "2510",
        courseId: "math-1000",
        section: "L1",
        classNumber: 2001,
        uuid: SPLIT_INSTRUCTOR_UUID,
        sourceName: "Split Instructor",
      },
    ],
  };
}
