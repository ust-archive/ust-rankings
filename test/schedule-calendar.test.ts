import { expect, test } from "vitest";
import { createScheduleCalendar } from "@/lib/schedule/calendar";
import type { ScheduleClass } from "@/lib/schedule/server";

const item: ScheduleClass = {
  termCode: "2510",
  coursePrefix: "COMP",
  courseNumber: "2000",
  courseCode: "COMP 2000",
  courseTitle: "Title, with semicolon; and newline\n",
  section: "L1",
  classNumber: 1001,
  role: "E",
  classType: "LEC",
  remarks: "",
  capacity: 50,
  enrollment: 20,
  waitlist: 0,
  consent: false,
  open: true,
  reservations: [],
  meetings: [
    {
      weekday: "Wed",
      dateFrom: "2025-09-01",
      dateTo: "2025-11-30",
      timeFrom: "23:30",
      timeTo: "00:30",
      room: "Rm 1409, Lift 25-26",
      roomCode: "1409",
      instructors: [{ sourceName: "Instructor" }],
    },
  ],
};

test("calendar exports Hong Kong weekly and overnight meetings with stable identities", async () => {
  const calendar = await createScheduleCalendar([item]);
  expect(calendar.body).toContain("DTSTART:20250903T153000Z");
  expect(calendar.body).toContain(
    "UID:2510-1001-1f2efff4c24c538b31fd0215@ust-rankings",
  );
  expect(calendar.body).toContain("DTEND:20250903T163000Z");
  expect(calendar.body).toContain("RRULE:FREQ=WEEKLY;UNTIL=20251130T163000Z");
  expect(calendar.body).toContain("Title\\, with semicolon\\; and newline\\n");
  expect(calendar.omitted).toBe(0);
  const changedRoom = await createScheduleCalendar([
    {
      ...item,
      meetings: item.meetings.map((meeting) => ({
        ...meeting,
        room: "Other room",
      })),
    },
  ]);
  expect(changedRoom.body.match(/UID:[^\r\n]+/)?.[0]).toBe(
    calendar.body.match(/UID:[^\r\n]+/)?.[0],
  );
});

test("calendar reports undated meetings and rejects selections with nothing to export", async () => {
  const undated = {
    ...item,
    classNumber: 2001,
    meetings: item.meetings.map((meeting) => ({
      ...meeting,
      dateFrom: undefined,
    })),
  };
  expect((await createScheduleCalendar([item, undated])).omitted).toBe(1);
  await expect(createScheduleCalendar([undated])).rejects.toThrow(
    "no dated meetings",
  );
});
