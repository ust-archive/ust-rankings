import { SchedulePageClient } from "./schedule-page-client";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await searchParams;
  return <SchedulePageClient />;
}
