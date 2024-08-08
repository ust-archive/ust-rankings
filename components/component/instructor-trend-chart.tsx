import "./instructor-trend-chart.css";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type InstructorScoreObject } from "@/data";
import { stopPropagation } from "@/lib/events";
import { AreaChart, type CustomTooltipProps } from "@tremor/react";
import ChartTooltip from "@tremor/react/dist/components/chart-elements/common/ChartTooltip";
import _ from "lodash";
import React, { useState } from "react";

type InstructorTrendChartProps = {
  scores: InstructorScoreObject[];
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

function allScoresAreInRegularTerm(scores: InstructorScoreObject[]): boolean {
  // 0: Fall; 2: Spring
  return scores.every((score) => score.term % 4 === 0 || score.term % 4 === 2);
}

export function InstructorTrendChart(props: InstructorTrendChartProps) {
  const [showRatings, setShowRatings] = useState<string[]>([]);

  const { scores } = props;
  if (scores.length === 0) {
    return <div>No score available</div>;
  }

  const scoreMap = _.keyBy(scores, (score) => score.term);

  // Asset non-null because there should be at least one score.
  const maxTerm = _.max(scores.map((score) => score.term))!;
  const minTerm = _.min(scores.map((score) => score.term))!;
  let terms = _.range(minTerm, maxTerm + 1);

  // If all scores are in regular term, we only show regular terms.
  if (allScoresAreInRegularTerm(scores)) {
    terms = terms.filter((term) => term % 4 === 0 || term % 4 === 2);
  }

  const chartData = terms.map((term) => {
    const score = scoreMap[term];
    return {
      semester: formatTerm(term),
      "Rating (Content)": score?.individualRatingContent ?? NaN,
      "Rating (Teaching)": score?.individualRatingTeaching ?? NaN,
      "Rating (Grading)": score?.individualRatingGrading ?? NaN,
      "Rating (Workload)": score?.individualRatingWorkload ?? NaN,
      "Rating (Instructor)": score?.individualRatingInstructor ?? NaN,
      Score: score?.score ?? NaN,
      Samples: score?.individualSamples ?? 0,
    };
  });

  const valueFormatter = (v: number) => (isNaN(v) ? "N/A" : v.toFixed(3));
  const CustomToolTip = (props: CustomTooltipProps) => {
    const { payload, active, label } = props;
    console.log(props);
    if (!payload) {
      return null;
    }

    const samples = payload[0]?.payload?.Samples as number;
    const newLabel = `${label} - Samples: ${samples}`;
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
        <ToggleGroupItem className="font-semibold" value="Rating (Content)">
          Content
        </ToggleGroupItem>
        <ToggleGroupItem className="font-semibold" value="Rating (Teaching)">
          Teaching
        </ToggleGroupItem>
        <ToggleGroupItem className="font-semibold" value="Rating (Grading)">
          Grading
        </ToggleGroupItem>
        <ToggleGroupItem className="font-semibold" value="Rating (Workload)">
          Workload
        </ToggleGroupItem>
        <ToggleGroupItem className="font-semibold" value="Rating (Instructor)">
          Instructor
        </ToggleGroupItem>
      </ToggleGroup>
      <AreaChart
        data={chartData}
        index="semester"
        categories={["Score", ...showRatings]}
        rotateLabelX={{ angle: -60 }}
        curveType="monotone"
        connectNulls={true}
        valueFormatter={valueFormatter}
        customTooltip={CustomToolTip}
      />
    </div>
  );
}
