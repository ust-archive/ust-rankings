import "./course-trend-chart.css";
import _ from "lodash";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type CourseRatings,
  Criteria,
  CriteriaName,
  formatTerm,
} from "@/data/ratings";
import { stopPropagation } from "@/lib/events";

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#9333ea",
  "#0891b2",
];

type CourseTrendChartProps = {
  ratings: CourseRatings;
};

type CourseChartDatum = {
  term: string;
  samplesUs: number;
  samplesSfq: number;
  instructors: string[];
  [criterion: string]: number | string | string[] | undefined;
};

function valueFormatter(value: unknown): string {
  return typeof value !== "number" || Number.isNaN(value)
    ? "N/A"
    : value.toFixed(3);
}

function CourseTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const datum = payload[0]?.payload as CourseChartDatum | undefined;
  if (!datum) {
    return null;
  }

  return (
    <div
      role="status"
      className="max-w-xs whitespace-pre-line rounded-md border border-gray-200 bg-white p-3 text-sm text-gray-900 shadow-md dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      <p className="font-semibold">{label}</p>
      <p>Samples (ust.space): {datum.samplesUs}</p>
      <p>Samples (SFQ): {datum.samplesSfq}</p>
      <p>Instructors: {datum.instructors.join("; ")}</p>
      <ul className="mt-2 list-none">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} style={{ color: entry.color }}>
            {entry.name}: {valueFormatter(entry.value)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CourseTrendChart({ ratings }: CourseTrendChartProps) {
  const [showRatings, setShowRatings] = useState<string[]>([
    CriteriaName.course,
  ]);

  const terms = useMemo(
    () =>
      _.chain(Criteria)
        .flatMap((criterion) =>
          Object.entries(ratings.ratings[criterion].samples),
        )
        .filter(([, samples]) => samples > 0)
        .map(([term]) => Number(term))
        .uniq()
        .sortBy((term) => term)
        .value(),
    [ratings.ratings],
  );

  const chartData: CourseChartDatum[] = terms.map((term) => ({
    term: formatTerm(term),
    samplesUs: ratings.ratings.content.samples[term] ?? 0,
    samplesSfq: ratings.ratings.course.samples[term] ?? 0,
    instructors: ratings.meta.instructors[term] ?? [],
    ...Object.fromEntries(
      Criteria.map((criterion) => [
        CriteriaName[criterion],
        ratings.ratings[criterion].bayesian[term],
      ]),
    ),
  }));

  return (
    // biome-ignore lint/a11y: This handler only prevents chart clicks from toggling the surrounding card.
    <div className="py-4" onClick={stopPropagation}>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="lg"
        value={showRatings}
        onValueChange={setShowRatings}
        className="flex-wrap px-4 font-bold"
        aria-label="Course rating criteria"
      >
        {Criteria.map((criterion) => (
          <ToggleGroupItem
            className="font-semibold"
            key={criterion}
            value={CriteriaName[criterion]}
          >
            {CriteriaName[criterion]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="h-80 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 10, right: 24, bottom: 48, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="term"
              angle={-60}
              textAnchor="end"
              interval={0}
              height={64}
            />
            <YAxis />
            <Tooltip content={(props) => <CourseTooltip {...props} />} />
            <Legend />
            {showRatings.map((criterion, index) => (
              <Area
                key={criterion}
                type="monotone"
                dataKey={criterion}
                connectNulls
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                fillOpacity={0.15}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
