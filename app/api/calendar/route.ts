import { createScheduleCalendar } from "@/lib/schedule/calendar";
import { MAX_PLANNER_CLASSES } from "@/lib/schedule/planner";
import { currentServerIndex } from "@/lib/server-index";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const term = query.get("term") ?? "";
  const raw = [...query.getAll("class"), ...query.getAll("number")];
  if (
    !/^\d{4}$/.test(term) ||
    !raw.length ||
    raw.length > MAX_PLANNER_CLASSES ||
    raw.some((number) => !/^[1-9]\d{0,5}$/.test(number))
  )
    return new Response("Select a Term and valid Classes.", { status: 400 });
  try {
    const index = await currentServerIndex();
    const classes = index.calendarClasses(term);
    if (!classes)
      return new Response("Calendar data is not available for this Term yet.", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    const numbers = new Set(raw.map(Number));
    const selected = classes.filter((item) => numbers.has(item.classNumber));
    if (selected.length !== numbers.size)
      return new Response("Some Classes could not be found in this Term.", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    if (
      !selected.some((item) =>
        item.meetings.some(
          (meeting) =>
            meeting.dateFrom &&
            meeting.dateTo &&
            meeting.timeFrom &&
            meeting.timeTo,
        ),
      )
    )
      return new Response(
        "Selected Classes have no dated meetings to export.",
        {
          status: 422,
          headers: { "Cache-Control": "no-store" },
        },
      );
    const calendar = await createScheduleCalendar(selected);
    return new Response(calendar.body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="ust-schedule.ics"',
        "Cache-Control": "public, max-age=300",
        "X-Delivery-Generation": index.generation,
      },
    });
  } catch {
    return new Response(
      "Calendar is temporarily unavailable. Please try again later.",
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
