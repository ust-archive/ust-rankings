import { readFile, writeFile } from "node:fs/promises";
import {
  type AcademicCalendar,
  parseAcademicCalendar,
} from "../lib/schedule/academic-calendar.ts";

const source = "https://caldates.ust.hk/cgi-bin/eng/ical.php";
const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`HKUST calendar returned ${response.status}`);
const calendar = {
  ...parseAcademicCalendar(await response.text()),
  source,
  retrievedAt: new Date().toISOString(),
};
const path = new URL("../lib/schedule/holidays.json", import.meta.url);
const existing = JSON.parse(await readFile(path, "utf8")) as AcademicCalendar[];
if (!Array.isArray(existing)) throw new Error("Invalid archived calendars");
const calendars = [
  ...existing.filter((item) => item.academicYear !== calendar.academicYear),
  calendar,
].sort((a, b) => a.academicYear - b.academicYear);
await writeFile(path, `${JSON.stringify(calendars, null, 2)}\n`);
console.log(
  `Updated HKUST academic calendar ${calendar.academicYear}-${calendar.academicYear + 1}`,
);
