import { InstructorRankingsPage } from "@/app/rankings/instructor-rankings-page";
import { readRankingPreference } from "@/lib/rankings/preference-server";

export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  const preference = await readRankingPreference();
  return <InstructorRankingsPage preference={preference} />;
}
