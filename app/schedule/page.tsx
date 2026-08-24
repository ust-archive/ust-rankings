import { SchedulePageClient } from "./schedule-page-client";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <SchedulePageClient
      search={typeof query.q === "string" ? query.q : undefined}
      termCode={typeof query.term === "string" ? query.term : undefined}
    />
  );
}
