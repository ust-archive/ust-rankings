import { Course, CourseClass, findClass } from "@/data/cq";
import { generateEventAttributes } from "@/data/cq/calendar-event";
import * as ics from "ics";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET: /api/calendar
 * Gets the iCalendar file for the given class (section) numbers.
 * Example: webcal://ust-rankings.vercel.app/api/calendar?term=2410&number=1023&number=1024
 */
export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get("term");
  const numbers = request.nextUrl.searchParams.getAll("samples");

  const webcal = Boolean(request.nextUrl.searchParams.get("webcal"));

  if (term === null || numbers.length === 0) {
    return new Response("Missing term or class numbers");
  }

  const classes = numbers
    .map((it) => findClass(term, it))
    .filter((it) => it !== undefined)
    .map((it) => it as [Course, CourseClass]);

  const event = ics.createEvents(
    classes.flatMap(([course, courseClass]) =>
      generateEventAttributes(course, courseClass),
    ),
  );

  if (event.error) {
    console.error(event.error);
    return new Response(event.error.message, { status: 500 });
  }

  if (webcal) {
    return new Response(event.value, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
      },
    });
  }

  return new Response(event.value, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="calendar.ics"',
    },
  });
}
