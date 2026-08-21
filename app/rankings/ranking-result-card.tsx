import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { gradeColor, letterGrade } from "@/lib/rankings/presentation";
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
  const percentile = result.percentile ?? result.allTimePercentile;
  const grade = letterGrade(percentile);
  const score = scoreFormat.format(result.score * 100);
  const background = gradeColor(percentile);
  return (
    <li
      data-ranking-result=""
      style={{ containIntrinsicSize: "auto 7rem", contentVisibility: "auto" }}
    >
      <Link
        className="group block touch-manipulation rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        href={detailsHref(result)}
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
        target="_blank"
      >
        <Card className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-white p-4 transition-shadow motion-reduce:transition-none hover:border-slate-300 hover:shadow-md group-focus-visible:border-slate-400 sm:gap-5 sm:p-6">
          <CardContent className="w-20 shrink-0 p-0 text-slate-600 sm:w-32">
            <p className="text-xl font-semibold tabular-nums sm:text-2xl">
              {result.rank ? `#${result.rank}` : "—"}{" "}
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
            <CardDescription className="text-xs leading-snug text-slate-600 sm:text-sm">
              {sampleCount(result.ustSpaceSamples, "ust.space")}.{" "}
              {sampleCount(result.sfqSamples, "SFQ")}.
            </CardDescription>
            <CardDescription className="text-xs leading-snug text-slate-500 tabular-nums">
              {result.rank
                ? `Rank ${result.rank} of ${result.rankPopulation}`
                : result.entity === "course"
                  ? "Not offered this Term"
                  : "Not teaching this Term"}{" "}
              · Rank of all time {result.allTimeRank} of{" "}
              {result.allTimePopulation}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Badge
              className="w-12 justify-center rounded-lg border-0 py-2 text-xl text-white shadow-sm [text-shadow:0_1px_2px_rgb(0_0_0_/_0.8)] sm:text-2xl"
              data-grade={grade}
              style={{ backgroundColor: `rgb(${background.join(", ")})` }}
            >
              <span className="sr-only">Grade </span>
              {grade}
            </Badge>
          </CardContent>
          <span className="sr-only">Opens in a new tab</span>
        </Card>
      </Link>
    </li>
  );
}
