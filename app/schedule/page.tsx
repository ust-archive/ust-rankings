import { parsePlannerQuery } from "@/lib/schedule/planner";
import { SchedulePageClient } from "./schedule-page-client";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = parsePlannerQuery(await searchParams);
  return <SchedulePageClient key={JSON.stringify(parsed)} parsed={parsed} />;
}
