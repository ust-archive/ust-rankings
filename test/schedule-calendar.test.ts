import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parseAcademicCalendar } from "@/lib/schedule/academic-calendar";
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

const meeting = item.meetings[0];
if (!meeting) throw new Error("Missing test meeting");

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

test("recurring meetings exclude Hong Kong holidays at the local start time", async () => {
  const calendar = await createScheduleCalendar([
    {
      ...item,
      termCode: "2610",
      meetings: [
        {
          ...meeting,
          weekday: "Mon",
          dateFrom: "2026-10-05",
          dateTo: "2026-11-30",
          timeFrom: "00:30",
          timeTo: "01:30",
        },
      ],
    },
  ]);
  expect(calendar.body).toContain("EXDATE:20261018T163000Z");
  expect(calendar.body).toContain("DTSTART:20261004T163000Z");
});

test("HKUST mid-term break excludes non-public-holiday teaching days", async () => {
  const calendar = await createScheduleCalendar([
    {
      ...item,
      meetings: [
        {
          ...meeting,
          dateFrom: "2026-04-01",
          dateTo: "2026-04-15",
          timeFrom: "11:00",
          timeTo: "12:00",
        },
      ],
    },
  ]);
  expect(calendar.body).toContain("EXDATE:20260408T030000Z");
});

test("date-specific venue changes and explicit one-off sessions survive holiday correction", async () => {
  const calendar = await createScheduleCalendar([
    {
      ...item,
      meetings: [
        {
          ...meeting,
          weekday: "Mon",
          dateFrom: "2026-09-01",
          dateTo: "2026-09-30",
          room: "Lecture Theater B",
        },
        {
          ...meeting,
          weekday: "Mon",
          dateFrom: "2026-10-05",
          dateTo: "2026-11-30",
          room: "LG6102",
        },
        {
          ...meeting,
          weekday: "Mon",
          dateFrom: "2026-10-19",
          dateTo: "2026-10-19",
          room: "Explicit session",
        },
      ],
    },
  ]);
  const entries = calendar.body.split("BEGIN:VEVENT").slice(1);
  expect(entries).toHaveLength(3);
  expect(entries[0]).toContain("LOCATION:Lecture Theater B");
  expect(entries[0]).not.toContain("EXDATE");
  expect(entries[1]).toContain("LOCATION:LG6102");
  expect(entries[1]).toContain("EXDATE:20261019T153000Z");
  expect(entries[2]).toContain("LOCATION:Explicit session");
  expect(entries[2]).not.toContain("EXDATE");
});

test("HKUST ICS separates holidays and mid-term break from administrative events", async () => {
  const raw = await readFile(
    new URL("./fixtures/hkust-calendar-2026-27.ics", import.meta.url),
    "utf8",
  );
  const calendar = parseAcademicCalendar(raw);
  expect(calendar.academicYear).toBe(2026);
  expect(calendar.closures).toHaveLength(18);
  expect(calendar.closures).toContainEqual({
    from: "2027-03-25",
    until: "2027-03-31",
    name: "Mid Term Break",
  });
  expect(calendar.closures).toContainEqual({
    from: "2026-10-19",
    until: "2026-10-20",
    name: "The day following the Chung Yeung Festival",
  });
  expect(
    calendar.closures.some((item) =>
      /Add.Drop|Examinations|Study Break/.test(item.name),
    ),
  ).toBe(false);
  expect(() => parseAcademicCalendar("<html>Unavailable</html>")).toThrow(
    "Invalid HKUST",
  );
});

test("missing academic-year coverage never exports uncorrected recurrences", async () => {
  await expect(
    createScheduleCalendar([
      {
        ...item,
        meetings: [
          { ...meeting, dateFrom: "2029-09-01", dateTo: "2029-11-30" },
        ],
      },
    ]),
  ).rejects.toThrow("holiday dates for 2029");
});
