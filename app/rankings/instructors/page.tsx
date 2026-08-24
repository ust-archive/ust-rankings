import type { InstructorRankingSearchParams } from "@/app/rankings/instructor-query";
import { InstructorRankingsPage } from "@/app/rankings/instructor-rankings-page";
import { readRankingPreference } from "@/lib/rankings/preference-server";

export const dynamic = "force-dynamic";

export default async function InstructorsPage({
  searchParams,
}: {
  searchParams: Promise<InstructorRankingSearchParams>;
}) {
  const [preference, query] = await Promise.all([
    readRankingPreference(),
    searchParams,
  ]);
  return (
    <InstructorRankingsPage preference={preference} searchParams={query} />
  );
}
