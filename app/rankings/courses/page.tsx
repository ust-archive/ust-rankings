import { CourseRankingsPage } from "@/app/rankings/course-rankings-page";
import { readRankingPreference } from "@/lib/rankings/preference-server";
import { COMMON_CORE_SCHEMES } from "@/lib/rankings/server";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const preference = await readRankingPreference();
  return (
    <CourseRankingsPage preference={preference} schemes={COMMON_CORE_SCHEMES} />
  );
}
