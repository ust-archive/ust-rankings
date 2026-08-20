import { handleScheduleCalendar } from "@/lib/schedule/calendar";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleScheduleCalendar(request, "class");
}
