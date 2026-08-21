import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  gradeColor,
  gradeForeground,
  letterGrade,
} from "@/lib/rankings/presentation";
import type { CourseRanking, InstructorRanking } from "@/lib/rankings/server";
import { coursePath, instructorPath } from "@/lib/routes";

type Ranking = CourseRanking | InstructorRanking;

const scoreFormat = new Intl.NumberFormat("en", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const countFormat = new Intl.NumberFormat("en");

function detailsHref(result: Ranking) {
  return result.entity === "course"
    ? coursePath(result.coursePrefix, result.courseNumber)
    : instructorPath(result);
}

function sampleCount(value: number, source: string) {
  return `${countFormat.format(value)} ${value === 1 ? "sample" : "samples"} from ${source}`;
}

export function RankingResultCard({ result }: { result: Ranking }) {
  const grade = letterGrade(result.globalPercentile);
  const score = scoreFormat.format(result.score * 100);
  const background = gradeColor(result.globalPercentile);
  const hasLocalContext =
    result.localRank !== result.globalRank ||
    result.localPopulation !== result.globalPopulation;
  return (
    <li
      data-ranking-result=""
      style={{ containIntrinsicSize: "auto 7rem", contentVisibility: "auto" }}
    >
      <Link
        className="group block touch-manipulation rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        href={detailsHref(result)}
        style={{ textDecoration: "none" }}
      >
        <Card className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-white p-4 transition-shadow motion-reduce:transition-none hover:border-slate-300 hover:shadow-md group-focus-visible:border-slate-400 sm:gap-5 sm:p-6">
          <CardContent className="w-20 shrink-0 p-0 text-slate-600 sm:w-32">
            <p className="text-xl font-semibold tabular-nums sm:text-2xl">
              #{result.localRank}{" "}
              <span className="hidden font-medium sm:inline">({score})</span>
            </p>
            <p className="text-xs tabular-nums sm:hidden">Score {score}</p>
          </CardContent>
          <CardHeader className="min-w-0 gap-0 p-0 text-left">
            <CardTitle asChild>
              <h2 className="wrap-break-word text-xl leading-tight tracking-normal text-slate-950 sm:text-2xl">
                {result.entity === "course"
                  ? result.courseCode
                  : result.canonicalName}
              </h2>
            </CardTitle>
            {result.entity === "course" && result.title ? (
              <CardDescription className="font-semibold text-slate-600">
                {result.title}
              </CardDescription>
            ) : null}
            <CardDescription className="leading-snug text-slate-600 sm:text-sm">
              {sampleCount(result.ustSpaceSamples, "ust.space")}.{" "}
              {sampleCount(result.sfqSamples, "SFQ")}.
            </CardDescription>
            <CardDescription className="text-xs leading-snug text-slate-500 tabular-nums">
              Global Rank {result.globalRank} of {result.globalPopulation}
              {hasLocalContext
                ? ` · Local Rank ${result.localRank} of ${result.localPopulation}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Badge
              className="w-12 justify-center rounded-lg border-0 py-2 text-xl shadow-sm sm:text-2xl"
              data-grade={grade}
              style={{
                backgroundColor: `rgb(${background.join(", ")})`,
                color: `rgb(${gradeForeground(background).join(", ")})`,
              }}
            >
              <span className="sr-only">Grade </span>
              {grade}
            </Badge>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}
