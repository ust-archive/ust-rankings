import { permanentRedirect } from "next/navigation";

export default function LegacyCourseRankings() {
  permanentRedirect("/rankings/courses");
}
