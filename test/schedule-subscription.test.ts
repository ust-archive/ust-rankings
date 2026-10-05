import { afterEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/calendar/route";
import {
  installServerIndexForTests,
  resetServerIndexForTests,
} from "@/lib/server-index";
import { serverIndexFixture } from "./server-index-fixture";

afterEach(resetServerIndexForTests);
test("older indices fail explicitly instead of emitting an empty subscription", async () => {
  installServerIndexForTests(serverIndexFixture());
  const response = await GET(
    new Request("https://example.test/api/calendar?term=2510&class=1001"),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
test("subscription tracks the active generation while retaining selected Classes", async () => {
  const index = serverIndexFixture();
  for (const row of index.classes)
    row.calendar = {
      courseTitle: "Example course",
      meetings: [
        {
          weekday: "Wed",
          dateFrom: "2025-09-01",
          dateTo: "2025-11-30",
          timeFrom: "11:00",
          timeTo: "11:50",
          room: "Old room",
          roomCode: "",
          instructors: [],
        },
      ],
    };
  installServerIndexForTests(index);
  const request = () =>
    new Request("https://example.test/api/calendar?term=2510&class=1001");
  const first = await (await GET(request())).text();
  expect(first).toContain("Old room");
  expect(first).toContain("EXDATE:");
  for (const row of index.classes)
    if (row.calendar) row.calendar.meetings[0].room = "New room";
  installServerIndexForTests(index);
  const second = await (await GET(request())).text();
  expect(second).toContain("New room");
  expect(second.match(/^UID:.*$/m)?.[0]).toBe(first.match(/^UID:.*$/m)?.[0]);
});
