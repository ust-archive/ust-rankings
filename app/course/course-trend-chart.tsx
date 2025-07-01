import "./course-trend-chart.css";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CourseRatings, Criteria, CriteriaName } from "@/data/ratings";
import { stopPropagation } from "@/lib/events";
import { AreaChart, type CustomTooltipProps } from "@tremor/react";
import ChartTooltip from "@tremor/react/dist/components/chart-elements/common/ChartTooltip";
import _ from "lodash";
import React, { useMemo, useState } from "react";

type CourseTrendChartProps = {
  ratings: CourseRatings;
};

export function formatTerm(n: number): string {
  const seasonMap = {
    0: "Fall",
    1: "Winter",
    2: "Spring",
    3: "Summer",
  };
  const year = 2000 + Math.floor(n / 4);
  const season = seasonMap[n % 4] as string;
  return `${year}-${year + 1} ${season}`;
}

export function CourseTrendChart({ ratings }: CourseTrendChartProps) {
  const [showRatings, setShowRatings] = useState<string[]>([
    CriteriaName["course"],
  ]);

  const terms = useMemo(
    () =>
      _.chain(Criteria)
        .flatMap((c) => Object.entries(ratings.ratings[c].samples))
        .filter(([, samples]) => samples > 0)
        .map(([term]) => Number(term))
        .uniq()
        .sort()
        .value(),
    [ratings.ratings],
  );

  const chartData = terms.map((term) => {
    return {
      term: formatTerm(term),
      samplesUs: ratings.ratings["content"].samples[term] ?? 0,
      samplesSfq: ratings.ratings["course"].samples[term] ?? 0,
      instructors: ratings.meta.instructors[term] ?? [],
      ...Object.fromEntries(
        Criteria.map((c) => [
          CriteriaName[c],
          ratings.ratings[c].bayesian[term],
        ]),
      ),
    };
  });

  const valueFormatter = (v: number) => (isNaN(v) ? "N/A" : v.toFixed(3));
  const CustomToolTip = (props: CustomTooltipProps) => {
    const { payload, active, label } = props;
    if (!payload) {
      return null;
    }

    const samplesUs = payload[0]?.payload?.samplesUs as number;
    const samplesSfq = payload[0]?.payload?.samplesSfq as number;
    const instructors = (
      payload[0]?.payload?.instructors ?? ([] as string[])
    ).join("; ");

    const newLabel =
      `${label}\n` +
      `Samples (ust.space): ${samplesUs}\n` +
      `Samples (SFQ): ${samplesSfq}\n` +
      `Instructors: ${instructors}`;
    return (
      <ChartTooltip
        active={active}
        payload={payload}
        label={newLabel}
        categoryColors={
          new Map(payload.map((it) => [it.name as string, it.color]))
        }
        valueFormatter={valueFormatter}
      />
    );
  };

  return (
    <div className="py-4" onClick={stopPropagation}>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="lg"
        value={showRatings}
        onValueChange={setShowRatings}
        className="flex-wrap px-4 font-bold"
      >
        {Criteria.map((c) => {
          return (
            <ToggleGroupItem
              className="font-semibold"
              key={c}
              value={CriteriaName[c]}
            >
              {CriteriaName[c]}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      <AreaChart
        data={chartData}
        index="term"
        categories={[...showRatings]}
        rotateLabelX={{ angle: -60 }}
        curveType="monotone"
        connectNulls={true}
        valueFormatter={valueFormatter}
        customTooltip={CustomToolTip}
        className="whitespace-pre-line"
      />
    </div>
  );
}
