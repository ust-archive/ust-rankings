import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { LoginLink } from "@/app/auth/login-link";
import { EntityTitleTransition } from "@/app/page-transition";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { PublicReview } from "@/lib/contributions/reviews";
import {
  gradeColor,
  letterGrade,
  rankingTermName,
} from "@/lib/rankings/presentation";
import type {
  CourseRankings,
  Rankings,
  ScoreDistribution,
} from "@/lib/rankings/server";
import type { ReviewEditorOptions } from "./course-reviews";
import { Reviews } from "./course-reviews";
import styles from "./details.module.css";
import { DetailsTrend } from "./details-trend";
import { ReviewNotice } from "./review-notice";
import { ReviewOrderSelect } from "./review-order-select";

const criteria = [
  ["content", "Content"],
  ["teaching", "Teaching"],
  ["grading", "Grading"],
  ["workload", "Workload"],
  ["course", "Course SFQ"],
  ["instructor", "Instructor SFQ"],
] as const;

const integer = new Intl.NumberFormat("en-US");
const score = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
  minimumFractionDigits: 4,
});
const percentile = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent",
});
const confidence = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

type DetailRankings = Pick<
  CourseRankings | Rankings,
  "configuration" | "population" | "ranking" | "terms"
>;

export function DetailsHeader({
  eyebrow,
  title,
  subtitle,
  termName,
  description,
  notice,
  transitionName,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  termName?: string;
  description?: string;
  notice?: ReactNode;
  transitionName?: string;
}) {
  return (
    <header className={`border-b border-slate-200 pb-7 ${styles.heading}`}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
        {eyebrow}
      </p>
      <EntityTitleTransition name={transitionName}>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          {title}
        </h1>
      </EntityTitleTransition>
      {subtitle ? (
        <p className="mt-2 max-w-3xl text-lg font-medium text-slate-700">
          {subtitle}
        </p>
      ) : null}
      {termName ? (
        <p className="mt-2 text-sm font-medium text-slate-600">{termName}</p>
      ) : null}
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
          {description}
        </p>
      ) : null}
      {notice}
    </header>
  );
}

function ScoreHistogram({
  distribution,
  entity,
  value,
}: {
  distribution: ScoreDistribution;
  entity: "Course" | "Instructor";
  value: number;
}) {
  const width = 240;
  const height = 44;
  const gap = 2;
  const barWidth = width / distribution.bins.length - gap;
  const maximumBin = Math.max(...distribution.bins, 1);
  const position =
    ((value - distribution.minimum) /
      (distribution.maximum - distribution.minimum || 1)) *
    width;
  return (
    <span className="mt-2 block min-w-0 flex-1">
      <svg
        aria-label={`Score distribution for ${integer.format(distribution.count)} ${entity}s`}
        className="h-12 w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{`${entity} score distribution`}</title>
        {distribution.bins.map((count, index) => {
          const barHeight = Math.max(2, (count / maximumBin) * (height - 6));
          const color = gradeColor(
            distribution.bins.length === 1
              ? 1
              : index / (distribution.bins.length - 1),
          );
          return (
            <rect
              fill={`rgb(${color.join(", ")})`}
              height={barHeight}
              // biome-ignore lint/suspicious/noArrayIndexKey: Histogram bins have fixed positional identity.
              key={index}
              rx="1"
              width={barWidth}
              x={index * (barWidth + gap)}
              y={height - barHeight}
            />
          );
        })}
        <line
          stroke="#003366"
          strokeWidth="3"
          x1={Math.max(1.5, Math.min(width - 1.5, position))}
          x2={Math.max(1.5, Math.min(width - 1.5, position))}
          y1="3"
          y2={height}
        />
      </svg>
      <span className="mt-1 flex justify-between text-xs text-slate-600 tabular-nums">
        <span>{score.format(distribution.minimum)}</span>
        <span>{score.format(distribution.maximum)}</span>
      </span>
    </span>
  );
}

function RankMetric({
  label,
  rank,
  population,
  percentileValue,
  unavailable,
}: {
  label: string;
  rank?: number;
  population: number;
  percentileValue?: number;
  unavailable?: string;
}) {
  return (
    <span className="block rounded-lg border border-slate-200 bg-white p-4 text-slate-900">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-600">
        {label}
      </span>
      {rank === undefined || percentileValue === undefined ? (
        <>
          <span className="mt-1 block text-xl font-bold">No Rank</span>
          <span className="mt-1 block text-sm text-slate-700">
            {unavailable}
          </span>
        </>
      ) : (
        <>
          <span className="mt-1 block text-xl font-bold tabular-nums">
            #{integer.format(rank)} of {integer.format(population)}
          </span>
          <span className="mt-1 block text-sm text-slate-700 tabular-nums">
            {percentile.format(percentileValue)} Percentile
          </span>
        </>
      )}
    </span>
  );
}

export function DetailsRankings({
  loading = false,
  rankings,
  selectedTermCode,
  scoreDistribution,
  termNames = new Map(),
}: {
  loading?: boolean;
  rankings?: DetailRankings;
  selectedTermCode?: string;
  scoreDistribution?: ScoreDistribution;
  termNames?: Map<string, string>;
}) {
  const evidence = rankings?.terms.find(
    (term) => term.termCode === selectedTermCode,
  );
  const selectedRanking =
    rankings && rankings.population.termCode === selectedTermCode
      ? rankings.ranking
      : undefined;
  const grade = selectedRanking
    ? letterGrade(
        selectedRanking.percentile ?? selectedRanking.allTimePercentile,
      )
    : undefined;
  return (
    <details
      aria-busy={loading}
      className="group overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-950 shadow-sm"
    >
      <summary className="relative cursor-pointer list-none p-5 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#003366] sm:p-6">
        <h2 className={`block pr-24 text-2xl text-slate-900 ${styles.heading}`}>
          Rankings
        </h2>
        {rankings ? (
          <span className="mt-1 block text-sm text-slate-600">
            {rankings.configuration.preset === "custom"
              ? "Custom"
              : rankings.configuration.preset === "grade"
                ? "Grade-focused"
                : "Learning-focused"}
          </span>
        ) : null}
        {selectedRanking && grade ? (
          <span className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <span className="block rounded-lg border border-slate-200 bg-white p-4 text-slate-900 sm:col-span-2">
              <span className="flex items-center gap-3">
                <span className="shrink-0">
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                    Score
                  </span>
                  <span className="mt-1 block text-xl font-bold tabular-nums">
                    {score.format(selectedRanking.score)}
                  </span>
                  <span className="mt-1 block text-sm text-slate-700">
                    Grade {grade}
                  </span>
                </span>
                {scoreDistribution ? (
                  <ScoreHistogram
                    distribution={scoreDistribution}
                    entity={
                      rankings?.population.entity === "course"
                        ? "Course"
                        : "Instructor"
                    }
                    value={selectedRanking.score}
                  />
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
              </span>
            </span>
            <RankMetric
              label="Rank"
              percentileValue={selectedRanking.percentile}
              population={selectedRanking.rankPopulation}
              rank={selectedRanking.rank}
              unavailable={
                rankings?.population.entity === "course"
                  ? "Not offered this Term"
                  : "Not teaching this Term"
              }
            />
            <RankMetric
              label="Rank of all time"
              percentileValue={selectedRanking.allTimePercentile}
              population={selectedRanking.allTimePopulation}
              rank={selectedRanking.allTimeRank}
            />
          </span>
        ) : (
          <span
            className="mt-5 block rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            role="status"
          >
            {rankings
              ? "Rank and score are unavailable for this population."
              : loading
                ? "Loading Rankings… Other Details remain available."
                : "Rankings are unavailable. Other Details remain available."}
          </span>
        )}
        <span className="absolute right-4 top-4 inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-700 sm:right-5 sm:top-5">
          <span className="group-open:hidden">More</span>
          <span className="hidden group-open:inline">Less</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-gray-200 bg-gray-50 p-5 sm:p-6">
        <section
          aria-labelledby="criterion-evidence"
          className="flex flex-col gap-4"
        >
          <h3 className="text-xl font-bold" id="criterion-evidence">
            Criterion Reference and Evidence
          </h3>
          <section
            aria-label="Current criterion evidence table"
            className="overflow-x-auto rounded-xl border border-slate-200"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the wide evidence table.
            tabIndex={0}
          >
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-3" scope="col">
                    Criterion
                  </th>
                  <th className="px-3 py-3" scope="col">
                    Ranking value
                  </th>
                  <th className="px-3 py-3" scope="col">
                    Confidence
                  </th>
                  <th className="px-3 py-3" scope="col">
                    Samples
                  </th>
                </tr>
              </thead>
              <tbody>
                {criteria.map(([criterion, label]) => {
                  const value = evidence?.criteria[criterion];
                  return (
                    <tr className="border-t border-slate-200" key={criterion}>
                      <th className="px-3 py-3 text-left font-bold" scope="row">
                        {label}
                      </th>
                      <td className="px-3 py-3 font-mono tabular-nums">
                        {value?.bayesian.toFixed(2) ?? "Unavailable"}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {value
                          ? confidence.format(value.confidence)
                          : "Unavailable"}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {value
                          ? `${integer.format(value.samples)} new · ${integer.format(value.cumulativeSamples)} cumulative`
                          : "Unavailable"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </section>
        <section
          aria-labelledby="trend-history"
          className="flex flex-col gap-4"
        >
          <h3 className="text-xl font-bold" id="trend-history">
            History
          </h3>
          <DetailsTrend
            selectedTermCode={selectedTermCode}
            terms={(rankings?.terms ?? []).map((term) => ({
              ...term,
              termName:
                termNames.get(term.termCode) ?? rankingTermName(term.termCode),
            }))}
          />
        </section>
      </div>
    </details>
  );
}

export function ExpandCardTrigger({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  if (!count) return null;
  return (
    <CollapsibleTrigger asChild>
      <Button
        className="gap-2 text-slate-700"
        size="sm"
        type="button"
        variant="ghost"
      >
        <span className="group-data-[state=open]:hidden">{count} More</span>
        <span className="hidden group-data-[state=open]:inline">Less</span>
        <span className="sr-only"> {label}</span>
        <ChevronDown
          aria-hidden="true"
          className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          data-icon="inline-end"
        />
      </Button>
    </CollapsibleTrigger>
  );
}

export function DetailsCommunityLoading() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle
          asChild
          className={`text-2xl text-balance ${styles.heading}`}
        >
          <h2>Community</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-3 text-sm text-slate-700">
        <Spinner aria-hidden="true" />
        <p>Loading Community…</p>
      </CardContent>
    </Card>
  );
}

export function DetailsCommunity({
  description,
  signalControls,
  reviewComposer,
  reviews,
  reviewsUnavailable,
  editor,
  signedIn,
  published,
  withdrawn,
  error,
}: {
  description?: string;
  signalControls: ReactNode;
  reviewComposer: ReactNode;
  reviews: PublicReview[];
  reviewsUnavailable: boolean;
  editor: ReviewEditorOptions;
  signedIn: boolean;
  published?: boolean;
  withdrawn?: boolean;
  error?: string;
}) {
  return (
    <Card id="reviews">
      <CardHeader className={description ? undefined : "pb-3"}>
        <CardTitle
          asChild
          className={`text-2xl text-balance ${styles.heading}`}
        >
          <h2>Community</h2>
        </CardTitle>
        {description ? (
          <p className="text-sm text-slate-600">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-label="Signals">{signalControls}</section>
        <Separator />
        <ReviewNotice
          error={error}
          published={published}
          withdrawn={withdrawn}
        />
        <section
          aria-labelledby="community-reviews"
          className="flex flex-col gap-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3
              className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600"
              id="community-reviews"
            >
              Reviews
            </h3>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <ReviewOrderSelect />
              {signedIn ? (
                reviewComposer
              ) : (
                <LoginLink>Login to create a review</LoginLink>
              )}
            </div>
          </div>
          {reviewsUnavailable ? (
            <p
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              role="status"
            >
              Reviews are unavailable. This does not represent zero reviews.
            </p>
          ) : (
            <Reviews displayTermNames editor={editor} reviews={reviews} />
          )}
        </section>
      </CardContent>
    </Card>
  );
}
