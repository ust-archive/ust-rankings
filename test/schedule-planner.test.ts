import { expect, test } from "bun:test";
import {
  buildScheduleUrl,
  findPlannerConflicts,
  parsePlannerQuery,
  parseSisImport,
} from "@/lib/schedule/planner";

test("planner query state is bounded, deduplicated, sorted, and canonical", () => {
  expect(
    parsePlannerQuery({
      term: "2510",
      q: " COMP ",
      class: ["2001", "1001", "1001"],
      view: "cart",
    }),
  ).toEqual({
    termCode: "2510",
    search: "COMP",
    classNumbers: [1001, 2001],
    view: "cart",
    messages: [],
  });

  expect(
    buildScheduleUrl({
      termCode: "2510",
      search: "COMP",
      classNumbers: [2001, 1001, 1001],
      view: "cart",
    }),
  ).toBe("/schedule?term=2510&q=COMP&class=1001&class=2001&view=cart");
});

test("unsupported planner values use safe defaults with validation messages", () => {
  const tooManyClasses = Array.from({ length: 51 }, (_, index) =>
    String(index + 1),
  );
  const state = parsePlannerQuery({
    term: ["2510", "2520"],
    q: "x".repeat(101),
    class: tooManyClasses,
    view: "calendar",
  });

  expect(state).toEqual({
    termCode: undefined,
    search: undefined,
    classNumbers: [],
    view: "browse",
    messages: [
      "Use exactly one Term Code.",
      "Search is limited to 100 characters.",
      "Select at most 50 Classes.",
      "Unknown Schedule view; showing Browse.",
    ],
  });

  const mixed = parsePlannerQuery({
    class: ["1001", "not-a-number", "2001"],
  });
  expect(mixed.classNumbers).toEqual([1001, 2001]);
  expect(mixed.messages).toEqual([
    'Ignored invalid Class Number "not-a-number".',
  ]);
});

test("planner conflicts require overlapping dates, weekday, and times", () => {
  const meeting = {
    weekday: "Wed",
    dateFrom: "2025-09-01",
    dateTo: "2025-11-30",
    timeFrom: "11:00",
    timeTo: "11:50",
  };
  expect(
    findPlannerConflicts([
      { classNumber: 1001, meetings: [meeting] },
      {
        classNumber: 2001,
        meetings: [{ ...meeting, timeFrom: "11:30", timeTo: "12:20" }],
      },
      {
        classNumber: 3001,
        meetings: [{ ...meeting, weekday: "Fri" }],
      },
    ]),
  ).toEqual([[1001, 2001]]);
});

test("SIS import is bounded and produces Class Numbers for the same URL state", () => {
  expect(parseSisImport("LEC (2001)\nTUT (1001)\nLEC (2001)")).toEqual({
    classNumbers: [1001, 2001],
    message: undefined,
  });
  expect(parseSisImport("No matching Classes")).toEqual({
    classNumbers: [],
    message: "No Class Numbers were found in the pasted SIS text.",
  });
  expect(parseSisImport("x".repeat(50_001))).toEqual({
    classNumbers: [],
    message: "SIS text is limited to 50,000 characters.",
  });
});
