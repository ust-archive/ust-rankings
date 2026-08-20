import { expect, test } from "bun:test";
import type { Course, CourseClass } from "../data/cq";
import { generateEventAttributes } from "../data/cq/calendar-event";

const course = {
  subject: "COMP",
  number: "1023",
  name: "Introduction to Python Programming",
} as Course;

function courseClass(
  overrides: Partial<CourseClass["schedule"][number]> = {},
): CourseClass {
  return {
    section: "L1",
    number: "1004",
    schedule: [
      {
        instructors: ["Ada Lovelace"],
        venue: "Room 101",
        fromDate: "2025-09-01",
        toDate: "2025-12-01",
        weekdays: [1],
        fromTime: "08:30:00",
        toTime: "09:50:00",
        ...overrides,
      },
    ],
  } as CourseClass;
}

test("interprets Schedule dates and times in Asia/Hong_Kong", () => {
  const [event] = generateEventAttributes(course, courseClass());

  expect(event).toMatchObject({
    start: [2025, 9, 1, 0, 30],
    end: [2025, 9, 1, 1, 50],
    startInputType: "utc",
    endInputType: "utc",
  });
  expect(event.recurrenceRule).toContain("UNTIL=20251201T015000Z");
});

test("handles Sunday plus midnight and noon without the host time zone", () => {
  const [midnight] = generateEventAttributes(
    course,
    courseClass({
      fromDate: "2025-09-01",
      toDate: "2025-09-07",
      weekdays: [0],
      fromTime: "00:00:00",
      toTime: "12:00:00",
    }),
  );

  expect(midnight).toMatchObject({
    start: [2025, 9, 6, 16, 0],
    end: [2025, 9, 7, 4, 0],
  });
  expect(midnight.recurrenceRule).toContain("UNTIL=20250907T040000Z");
});
