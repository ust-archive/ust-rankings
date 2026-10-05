import { DateTime } from "luxon";

export type AcademicCalendar = {
  academicYear: number;
  source: string;
  retrievedAt: string;
  closures: { from: string; until: string; name: string }[];
};

// HKUST's feed has no CATEGORIES. Only these event names describe no-class dates;
// enrollment deadlines, examinations and term boundary events are not closures.
const closureName =
  /^(?:Mid[ -]Term Break)$|festival|christmas|good friday|easter monday|labou?r day|national day|lunar new year|first day of january|birthday of the buddha|region establishment day/i;

export function parseAcademicCalendar(
  text: string,
): Pick<AcademicCalendar, "academicYear" | "closures"> {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const academicYear = Number(
    unfolded.match(/Commencement of the (\d{4})-\d{2} Academic Year/i)?.[1],
  );
  if (!academicYear || !unfolded.includes("END:VCALENDAR"))
    throw new Error("Invalid HKUST academic calendar");
  const closures: AcademicCalendar["closures"] = [];
  for (const event of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const name = event.match(/^SUMMARY:(.*)$/m)?.[1]?.trim();
    if (!name || !closureName.test(name)) continue;
    const start = event.match(/^DTSTART;VALUE=DATE:(\d{8})/m)?.[1];
    const end = event.match(/^DTEND;VALUE=DATE:(\d{8})/m)?.[1];
    const from = DateTime.fromFormat(start ?? "", "yyyyMMdd", { zone: "UTC" });
    const until = end
      ? DateTime.fromFormat(end, "yyyyMMdd", { zone: "UTC" })
      : from.plus({ days: 1 });
    if (
      !from.isValid ||
      !until.isValid ||
      until <= from ||
      /RRULE:/.test(event)
    )
      throw new Error("Unsupported HKUST closure event");
    closures.push({
      from: from.toFormat("yyyy-MM-dd"),
      until: until.toFormat("yyyy-MM-dd"),
      name,
    });
  }
  if (
    closures.length < 15 ||
    !closures.some((event) => /Mid[ -]Term Break/i.test(event.name))
  )
    throw new Error("Incomplete HKUST calendar");
  return {
    academicYear,
    closures: closures.sort(
      (a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name),
    ),
  };
}
