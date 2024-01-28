import React from 'react';
import {AreaChart, type CustomTooltipProps} from '@tremor/react';
import {type RatingObject} from '@/data';
import ChartTooltip from '@tremor/react/dist/components/chart-elements/common/ChartTooltip';

type Props = {
  thumbRatings: RatingObject[];
  teachRatings: RatingObject[];
};

function groupBy<I, O>(key: (it: I) => O): (r: Record<string, I[]>, v: I, i: number, a: I[]) => Record<string, I[]> {
  // @ts-expect-error Just Stop It!!!
  // eslint-disable-next-line no-return-assign,max-params,@typescript-eslint/no-unsafe-call,no-sequences
  return (r, v, _i, _a, k = key(v)) => ((r[k] ?? (r[k] = [])).push(v), r);
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function fmtSemester(n: number): string {
  const seasonMap = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    0: 'Fall',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    1: 'Winter',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    2: 'Spring',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    3: 'Summer',
  };
  const year = (Math.floor(n / 4) + 2012) % 100;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const season = seasonMap[n % 4];
  return `${year}-${year + 1} ${season}`;
}

export function InstructorRatingChart({teachRatings, thumbRatings}: Props) {
  const teachRatingGroups = teachRatings.reduce(groupBy(it => it.time), {});
  const thumbRatingGroups = thumbRatings.reduce(groupBy(it => it.time), {});
  const maxSemester = Math.max(...teachRatings.map(it => it.time), ...thumbRatings.map(it => it.time));
  const minSemester = Math.min(...teachRatings.map(it => it.time), ...thumbRatings.map(it => it.time));
  let semesters = Array
    .from({length: maxSemester - minSemester + 1}, (_, i) => i + minSemester)
    .sort((a, b) => b - a);
  const noRatingsForIrregularSemesters = semesters
    .filter(semester => semester % 2 !== 0) // Get all irregular semesters.
    .map(it => !thumbRatingGroups[it] && !teachRatingGroups[it]) // Check if there is no rating for the irregular semester.
    .reduce((acc, cur) => acc && cur, true); // Check if all irregular semesters have no rating.
  if (noRatingsForIrregularSemesters) {
    semesters = semesters.filter(semester => semester % 2 === 0);
  }

  const chartData = semesters
    .map(semester => ({
      semester: fmtSemester(semester),
      'Rating (Thumbs Up)': mean((thumbRatingGroups[semester] ?? []).map(it => it.rating)),
      'Rating (Teaching)': mean((teachRatingGroups[semester] ?? []).map(it => it.rating)),
      Samples: ((teachRatingGroups[semester]?.length ?? 0) + (thumbRatingGroups[semester]?.length ?? 0)) / 2,
    }));

  const valueFormatter = (v: number) => isNaN(v) ? 'N/A' : v.toFixed(3);
  const CustomToolTip = (props: CustomTooltipProps) => {
    const {payload, active, label} = props;
    if (!payload) {
      return null;
    }

    const samples = payload[0]?.payload?.Samples as number;
    const newLabel = `${label} - Samples: ${samples}`;
    return <ChartTooltip
      active={active}
      payload={payload}
      label={newLabel}
      categoryColors={new Map(payload.map(it => [it.name as string, it.color]))}
      valueFormatter={valueFormatter}
    />;
  };

  return <div className=''>
    <AreaChart
      data={chartData}
      index='semester'
      categories={['Rating (Thumbs Up)', 'Rating (Teaching)']}
      rotateLabelX={{angle: -60, xAxisHeight: 50}}
      curveType='monotone'
      connectNulls={true}
      valueFormatter={valueFormatter}
      customTooltip={CustomToolTip}
    />
  </div>;
}
