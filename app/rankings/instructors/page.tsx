import type { Metadata } from "next";
import { InstructorRankingsPage } from "@/app/rankings/instructor-rankings-page";
import { readRankingPreference } from "@/lib/rankings/preference-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Instructor Rankings | UST Rankings",
  description:
    "Compare HKUST Instructor rankings using student reviews and official SFQ evidence.",
  alternates: { canonical: "/rankings/instructors" },
};

export default async function InstructorsPage() {
  const preference = await readRankingPreference();
  return <InstructorRankingsPage preference={preference} />;
}
