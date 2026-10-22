"use client";

import { ArrowUpRight, ChartSpline } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type DistributionSummary,
  fitDistribution,
} from "@/lib/tools/distribution";

// Extend the existing campus ledger: gold masthead, one tool card, blue curve.
// The task stays in a dialog; class inputs lead to an explicitly estimated standing.
const fields = [
  ["low", "Low", "0"],
  ["high", "High", "100"],
  ["lq", "Lower Quartile (LQ)", "40"],
  ["uq", "Upper Quartile (UQ)", "70"],
  ["median", "Median", "55"],
  ["mean", "Mean", "54"],
  ["standardDeviation", "Standard Deviation", "Optional"],
  ["score", "Your Score", "75"],
] as const;

type FieldName = (typeof fields)[number][0];
type Values = Record<FieldName, string>;
type Fit = ReturnType<typeof fitDistribution>;
type Result = { fit: Fit; summary: DistributionSummary; score: number };
const requiredFields = new Set(["low", "high", "score"]);
const aboveScoreColor = "#c6d2de";

const emptyValues: Values = {
  low: "",
  high: "",
  lq: "",
  uq: "",
  median: "",
  mean: "",
  standardDeviation: "",
  score: "",
};
const exampleValues: Values = {
  low: "0",
  high: "100",
  lq: "40",
  uq: "70",
  median: "55",
  mean: "54",
  standardDeviation: "",
  score: "75",
};
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function percent(value: number) {
  return value < 0.001 ? "<0.1%" : `${(value * 100).toFixed(1)}%`;
}

function DistributionCurve({ fit, summary, score }: Result) {
  const id = useId();
  const left = 28;
  const right = 332;
  const bottom = 180;
  const x = (value: number) =>
    left +
    ((value - summary.low) / (summary.high - summary.low)) * (right - left);
  const peak = Math.max(...fit.points.map((point) => point.density));
  const line = fit.points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${x(point.score)},${bottom - (point.density / peak) * 140}`,
    )
    .join(" ");
  const area = `${line} L${right},${bottom} L${left},${bottom} Z`;
  return (
    <figure className="min-w-0">
      <svg
        viewBox="0 0 360 220"
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        className="w-full text-[#003366]"
      >
        <title id={`${id}-title`}>Estimated Grade Distribution</title>
        <desc id={`${id}-description`}>
          A fitted beta curve from {number.format(summary.low)} to{" "}
          {number.format(summary.high)}. Your score is {number.format(score)}.
          The shaded area shows scores above yours.
        </desc>
        <defs>
          <clipPath id={`${id}-tail`}>
            <rect x={x(score)} y="0" width={right - x(score)} height={bottom} />
          </clipPath>
        </defs>
        {[0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={left}
            x2={right}
            y1={bottom - fraction * 140}
            y2={bottom - fraction * 140}
            stroke="#e2e8f0"
            strokeDasharray="3 5"
          />
        ))}
        <path d={area} fill="currentColor" fillOpacity="0.05" />
        <path d={area} fill={aboveScoreColor} clipPath={`url(#${id}-tail)`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <line
          x1={x(score)}
          x2={x(score)}
          y1="25"
          y2={bottom}
          stroke="#996600"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#94a3b8" />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const value = summary.low + fraction * (summary.high - summary.low);
          return (
            <text
              key={fraction}
              x={x(value)}
              y="204"
              textAnchor="middle"
              fill="#475569"
              className="text-base tabular-nums md:text-xs"
            >
              {number.format(value)}
            </text>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 bg-[#996600]" />
          Your Score: {number.format(score)}
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="size-3"
            style={{ backgroundColor: aboveScoreColor }}
          />
          Scores Above Yours
        </span>
      </figcaption>
    </figure>
  );
}

function DistributionForm() {
  const [values, setValues] = useState(emptyValues);
  const fitting = useMemo(() => {
    if (!values.low.trim() || !values.high.trim()) return {};
    const quartileCount = [values.lq, values.median, values.uq].filter(
      (value) => value.trim(),
    ).length;
    if (
      quartileCount < 2 &&
      !(values.mean.trim() && values.standardDeviation.trim())
    )
      return {};
    try {
      const optional = (value: string) =>
        value.trim() ? Number(value) : undefined;
      const summary: DistributionSummary = {
        low: Number(values.low),
        high: Number(values.high),
        lq: optional(values.lq),
        uq: optional(values.uq),
        median: optional(values.median),
        mean: optional(values.mean),
        standardDeviation: optional(values.standardDeviation),
      };
      return { fit: fitDistribution(summary), summary };
    } catch (cause) {
      return {
        error:
          cause instanceof Error
            ? cause.message
            : "Check your statistics and try again.",
      };
    }
  }, [
    values.low,
    values.high,
    values.lq,
    values.uq,
    values.median,
    values.mean,
    values.standardDeviation,
  ]);
  const score = Number(values.score);
  const scoreError =
    values.score.trim() &&
    fitting.summary &&
    (!Number.isFinite(score) ||
      score < fitting.summary.low ||
      score > fitting.summary.high)
      ? "Your Score must be between Low and High."
      : undefined;
  const error = fitting.error ?? scoreError;
  const result =
    fitting.fit && values.score.trim() && !error
      ? { fit: fitting.fit, summary: fitting.summary, score }
      : undefined;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <FieldSet className="gap-3">
          <FieldLegend>Class Statistics</FieldLegend>
          <FieldGroup className="grid grid-cols-2 gap-x-3 gap-y-4">
            {fields.map(([name, label, placeholder]) => (
              <Field
                key={name}
                className={
                  name === "standardDeviation" || name === "score"
                    ? "col-span-2 gap-2"
                    : "gap-2"
                }
              >
                <FieldLabel
                  htmlFor={`distribution-${name}`}
                  className="flex-wrap gap-x-1 gap-y-1"
                >
                  {label}
                  {!requiredFields.has(name) && (
                    <span className="font-normal text-slate-500">
                      (Optional)
                    </span>
                  )}
                </FieldLabel>
                <Input
                  id={`distribution-${name}`}
                  name={name}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  required={requiredFields.has(name)}
                  placeholder={placeholder}
                  value={values[name]}
                  aria-describedby={error ? "distribution-error" : undefined}
                  className="tabular-nums"
                  onChange={(event) => {
                    setValues({ ...values, [name]: event.target.value });
                  }}
                />
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
        {error && (
          <Alert id="distribution-error">
            <AlertTitle>Check Your Values</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setValues(exampleValues);
            }}
          >
            Try an Example
          </Button>
        </div>
      </div>
      <section
        aria-label="Distribution Result"
        className="flex min-w-0 flex-col gap-5 rounded-md bg-slate-50 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366] sm:p-5"
      >
        {result ? (
          <>
            <div aria-live="polite" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-slate-600">
                Estimated Standing
              </h3>
              <p className="text-4xl font-bold tracking-tight text-[#003366] tabular-nums">
                Top {percent(1 - result.fit.percentile(result.score))}
              </p>
              <p className="text-sm text-slate-600">
                Above approximately{" "}
                {percent(result.fit.percentile(result.score))} of modeled
                scores.
              </p>
            </div>
            <DistributionCurve {...result} />
            <dl className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-sm tabular-nums">
              <div>
                <dt className="text-slate-600">Fitted Mean</dt>
                <dd className="mt-1 font-semibold">
                  {number.format(result.fit.mean)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Fitted Standard Deviation</dt>
                <dd className="mt-1 font-semibold">
                  {number.format(result.fit.standardDeviation)}
                </dd>
              </div>
            </dl>
            {[result.summary.lq, result.summary.median, result.summary.uq].some(
              (value) => value !== undefined,
            ) && (
              <p className="text-xs leading-relaxed text-slate-600">
                Largest Quartile Difference:{" "}
                {number.format(result.fit.maxQuantileError)} score units.
                {result.fit.maxQuantileError >
                  (result.summary.high - result.summary.low) * 0.05 &&
                  " The statistics do not closely match a beta curve; treat this as a rough estimate."}
              </p>
            )}
          </>
        ) : (
          <Empty className="min-h-52 p-2 md:min-h-80 md:p-3">
            <EmptyHeader>
              <ChartSpline
                aria-hidden="true"
                className="mb-2 size-10 text-[#003366]"
              />
              <EmptyTitle>See Where You Stand</EmptyTitle>
              <EmptyDescription>
                Enter Low, High and Your Score, plus two quartiles or Mean and
                Standard Deviation.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <details className="mt-auto border-t border-slate-200 pt-4 text-sm text-slate-600">
          <summary className="cursor-pointer rounded-sm font-medium text-slate-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#003366]">
            How the Estimate Works
          </summary>
          <div className="mt-3 flex flex-col gap-3 text-xs leading-relaxed">
            <p>
              A beta curve is fitted to the statistics you provide. Low and High
              are treated as hard bounds, even when they are observed class
              extremes. The fitted curve may not match every statistic exactly.
            </p>
            <a
              href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda366h.htm"
              className="w-fit underline underline-offset-4"
            >
              About the Beta Distribution (NIST)
            </a>
          </div>
        </details>
      </section>
    </div>
  );
}

export function DistributionFitting() {
  return (
    <Dialog>
      <Card className="text-left">
        <CardHeader className="gap-3">
          <ChartSpline aria-hidden="true" className="size-8 text-[#003366]" />
          <CardTitle asChild>
            <h2>Distribution Fitting</h2>
          </CardTitle>
          <CardDescription>
            Turn class statistics into a grade distribution and estimate where
            your score stands.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2">
              Open Tool
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Button>
          </DialogTrigger>
        </CardFooter>
      </Card>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-lg p-0 text-left">
        <DialogHeader className="shrink-0 gap-2 border-b border-slate-200 p-6 pr-12 text-left">
          <DialogTitle>Distribution Fitting</DialogTitle>
          <DialogDescription>
            Fit a curve to your class statistics and estimate your percentile.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
          <DistributionForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
