import type { Metadata } from "next";
import { CourseRankingsPage } from "@/app/rankings/course-rankings-page";
import { readRankingPreference } from "@/lib/rankings/preference-server";
import { COMMON_CORE_SCHEMES } from "@/lib/rankings/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Course Rankings | UST Rankings",
  description:
    "Compare HKUST Course rankings using student reviews and official SFQ evidence.",
  alternates: { canonical: "/rankings/courses" },
};

export default async function CoursesPage() {
  const preference = await readRankingPreference();
  return (
    <CourseRankingsPage preference={preference} schemes={COMMON_CORE_SCHEMES} />
  );
}
