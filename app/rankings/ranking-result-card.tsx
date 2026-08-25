import { EntityLink } from "@/app/entity-navigation";
import { EntityTitleTransition } from "@/app/page-transition";
import {
  courseTitleTransitionName,
  instructorTitleTransitionName,
} from "@/app/transition-names";
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

function presentation(result: Ranking) {
  if (result.entity === "course")
    return {
      description: result.title,
      href: coursePath(result.coursePrefix, result.courseNumber),
      title: result.courseCode,
      transitionName: courseTitleTransitionName(
        result.coursePrefix,
        result.courseNumber,
      ),
      unrankedLabel: "Not offered this Term",
    };
  return {
    description: undefined,
    href: instructorPath(result),
    title: result.canonicalName,
    transitionName: instructorTitleTransitionName(result.uuid),
    unrankedLabel: "Not teaching this Term",
  };
}

function sampleCount(value: number, source: string) {
  return `${countFormat.format(value)} ${value === 1 ? "sample" : "samples"} from ${source}`;
}

export function RankingResultCard({
  generation,
  result,
}: {
  generation?: string;
  result: Ranking;
}) {
  const cardPresentation = presentation(result);
  const navigationHref =
    result.entity === "instructor" && generation
      ? `${cardPresentation.href}?_generation=${generation}&_instructor=${result.uuid}`
      : undefined;
  const percentile = result.percentile ?? result.allTimePercentile;
  const grade = letterGrade(percentile);
  const score = scoreFormat.format(result.score * 100);
  const background = gradeColor(percentile);
  return (
    <li
      style={{ containIntrinsicSize: "auto 7rem", contentVisibility: "auto" }}
    >
      <EntityLink
        className="group block touch-manipulation rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        href={navigationHref ?? cardPresentation.href}
        navigationHref={navigationHref}
        prefetch
        style={{ textDecoration: "none" }}
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
            <EntityTitleTransition name={cardPresentation.transitionName}>
              <CardTitle asChild>
                <h2 className="wrap-break-word text-xl leading-tight tracking-normal text-slate-950 sm:text-2xl">
                  {cardPresentation.title}
                </h2>
              </CardTitle>
            </EntityTitleTransition>
            {cardPresentation.description ? (
              <CardDescription className="font-semibold text-slate-600">
                {cardPresentation.description}
              </CardDescription>
            ) : null}
            <CardDescription className="text-xs leading-snug text-slate-600 sm:text-sm">
              {sampleCount(result.ustSpaceSamples, "ust.space")}.{" "}
              {sampleCount(result.sfqSamples, "SFQ")}.
            </CardDescription>
            <CardDescription className="text-xs leading-snug text-slate-500 tabular-nums">
              {result.rank
                ? `Rank ${result.rank} of ${result.rankPopulation}`
                : cardPresentation.unrankedLabel}{" "}
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
        </Card>
      </EntityLink>
    </li>
  );
}
