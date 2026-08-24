import type { CourseRankingSearchParams } from "@/app/rankings/course-query";
import { CourseRankingsPage } from "@/app/rankings/course-rankings-page";
import { readRankingPreference } from "@/lib/rankings/preference-server";
import { COMMON_CORE_SCHEMES } from "@/lib/rankings/server";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<CourseRankingSearchParams>;
};

export default async function CoursesPage({ searchParams }: Props) {
  const [preference, query] = await Promise.all([
    readRankingPreference(),
    searchParams,
  ]);
  return (
    <CourseRankingsPage
      preference={preference}
      schemes={COMMON_CORE_SCHEMES}
      searchParams={query}
    />
  );
}
