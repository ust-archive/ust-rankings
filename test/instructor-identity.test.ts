import { expect, test } from "vitest";
import {
  buildInstructorIdentityHistory,
  type InstructorAssociationCorrection,
} from "@/lib/instructor-identity";

const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
const alpha = "00000000-0000-4000-8000-000000000001";
const beta = "00000000-0000-4000-8000-000000000002";
const gamma = "00000000-0000-4000-8000-000000000003";

function correction(
  value: Partial<InstructorAssociationCorrection>,
): InstructorAssociationCorrection {
  return {
    correctionType: "calibration",
    sourceCommit,
    sourceName: "Lee, Alex",
    courseCode: "COMP 1000",
    targetUuid: beta,
    ...value,
  };
}

test("Instructor Identity History projects redirects, identifiers, and scoped corrections", () => {
  const history = buildInstructorIdentityHistory({
    sourceCommit,
    identities: [
      { uuid: alpha, aliasSourceCommits: [] },
      { uuid: beta, itsc: "alex", aliasSourceCommits: [] },
      { uuid: gamma, itsc: "gamma", aliasSourceCommits: [] },
    ],
    events: [
      { type: "merge", retiredUuid: gamma, survivorUuid: beta, sourceCommit },
      { type: "itsc-added", uuid: alpha, itsc: "alex-old", sourceCommit },
    ],
    associationCorrections: [
      correction({ targetUuid: beta }),
      correction({ termCode: "2510", targetUuid: alpha }),
    ],
  });

  expect(history.resolveUuid(gamma)).toBe(beta);
  expect(history.itscByUuid.get(beta)).toBe("alex");
  expect(history.itscByUuid.get(gamma)).toBe("gamma");
  expect(history.identifiersByUuid.get(gamma)?.[0]?.status).toBe("retired");
  expect(history.uuidByItsc.get("alex-old")).toBe(alpha);
  expect(history.uuidByItsc.get("alex")).toBe(beta);
  expect(
    history.matchAssociation({
      sourceName: "Alex Lee",
      sourceAliases: ["Lee, Alex"],
      termCode: "2510",
      courseCode: "COMP 1000",
    })?.targetUuid,
  ).toBe(alpha);
  expect(
    history.matchAssociation({
      sourceName: "Lee, Alex",
      termCode: "2520",
      courseCode: "COMP 1000",
    })?.targetUuid,
  ).toBe(beta);
});

test("Instructor Identity History resolves Calibrations and fails closed on split mismatches", () => {
  const history = buildInstructorIdentityHistory({
    sourceCommit,
    identities: [
      { uuid: alpha, aliasSourceCommits: [] },
      { uuid: beta, aliasSourceCommits: [sourceCommit] },
    ],
    events: [{ type: "split", sourceUuid: alpha, newUuid: beta, sourceCommit }],
    associationCorrections: [
      correction({
        correctionType: "calibration",
        sourceName: "Wrong, Name",
        targetUuid: beta,
      }),
      correction({
        correctionType: "split",
        sourceName: "Split, Name",
        targetUuid: beta,
      }),
    ],
  });

  expect(
    history.resolveAssociation({
      sourceName: "Wrong, Name",
      termCode: "2510",
      courseCode: "COMP 1000",
      uuid: alpha,
    }),
  ).toMatchObject({ status: "resolved", uuid: beta });
  expect(
    history.resolveAssociation({
      sourceName: "Split, Name",
      termCode: "2510",
      courseCode: "COMP 1000",
      uuid: alpha,
    }).status,
  ).toBe("needs-resolution");
  expect(
    history.resolveAssociation({
      sourceName: "Split, Name",
      termCode: "2510",
      courseCode: "COMP 1000",
      uuid: beta,
    }),
  ).toMatchObject({ status: "resolved", uuid: beta });
});

test("a split requires at least one scoped Instructor Association Correction", () => {
  expect(() =>
    buildInstructorIdentityHistory({
      sourceCommit,
      identities: [
        { uuid: alpha, aliasSourceCommits: [] },
        { uuid: beta, aliasSourceCommits: [sourceCommit] },
      ],
      events: [
        { type: "split", sourceUuid: alpha, newUuid: beta, sourceCommit },
      ],
      associationCorrections: [],
    }),
  ).toThrow("Invalid Instructor split");
});

test("a Calibration resolves a matching split scope when both name the same target", () => {
  const history = buildInstructorIdentityHistory({
    sourceCommit,
    identities: [
      { uuid: alpha, aliasSourceCommits: [] },
      { uuid: beta, aliasSourceCommits: [sourceCommit] },
    ],
    events: [{ type: "split", sourceUuid: alpha, newUuid: beta, sourceCommit }],
    associationCorrections: [
      correction({
        correctionType: "split",
        sourceName: "Split, Name",
        targetUuid: beta,
      }),
      correction({
        correctionType: "calibration",
        sourceName: "Split, Name",
        targetUuid: beta,
      }),
    ],
  });

  expect(
    history.resolveAssociation({
      sourceName: "Split, Name",
      termCode: "2510",
      courseCode: "COMP 1000",
      uuid: alpha,
    }),
  ).toMatchObject({
    status: "resolved",
    uuid: beta,
    correction: { correctionType: "calibration" },
  });
});

test("equal-specificity cross-kind corrections reject conflicting targets", () => {
  expect(() =>
    buildInstructorIdentityHistory({
      sourceCommit,
      identities: [
        { uuid: alpha, aliasSourceCommits: [] },
        { uuid: beta, aliasSourceCommits: [sourceCommit] },
        { uuid: gamma, aliasSourceCommits: [] },
      ],
      events: [
        { type: "split", sourceUuid: alpha, newUuid: beta, sourceCommit },
      ],
      associationCorrections: [
        correction({ correctionType: "split", targetUuid: beta }),
        correction({ correctionType: "calibration", targetUuid: gamma }),
      ],
    }),
  ).toThrow("Conflicting Instructor association correction");
});
