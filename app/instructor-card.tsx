import { InstructorTrendChart } from "@/app/instructor-trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Criteria, CriteriaName, InstructorRatings } from "@/data/ratings";
import { stopPropagation } from "@/lib/events";
import { naturalSort } from "@/lib/utils";
import _ from "lodash";
import React, { useMemo } from "react";

type InstructorCardProps = {
  ratings: InstructorRatings;
  term: number;
};

type Color = [number, number, number];

function letterGrade(percentile: number) {
  for (const [threshold, grade] of [
    [0.9, "A+"],
    [0.8, "A"],
    [0.75, "A-"],
    [0.6, "B+"],
    [0.45, "B"],
    [0.35, "B-"],
    [0.3, "C+"],
    [0.25, "C"],
    [0.2, "C-"],
    [0.1, "D"],
    [0.0, "F"],
  ] as Array<[number, string]>) {
    if (percentile >= threshold) {
      return grade;
    }
  }

  return "F";
}

function gradeColor(ratio: number): Color {
  const colorStops = [
    { ratio: 0.0, color: [237, 27, 47] as Color },
    {
      ratio: 0.25,
      color: [250, 166, 26] as Color,
    },
    { ratio: 0.75, color: [163, 207, 98] as Color },
    { ratio: 1.0, color: [0, 154, 97] as Color },
  ];

  function lerp(start: number, end: number, t: number): number {
    return start * (1 - t) + end * t;
  }

  function blendColors(color1: Color, color2: Color, t: number): Color {
    return [
      Math.round(lerp(color1[0], color2[0], t)),
      Math.round(lerp(color1[1], color2[1], t)),
      Math.round(lerp(color1[2], color2[2], t)),
    ];
  }

  for (let i = 0; i < colorStops.length - 1; i++) {
    const currentStop = colorStops[i];
    const nextStop = colorStops[i + 1];

    if (ratio >= currentStop.ratio && ratio <= nextStop.ratio) {
      const t =
        (ratio - currentStop.ratio) / (nextStop.ratio - currentStop.ratio);
      return blendColors(currentStop.color, nextStop.color, t);
    }
  }

  return [0, 0, 0]; // Default color if the ratio is out of range
}

function cssColor(color: Color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function formatNumber(num?: number): string {
  if (num === undefined || isNaN(num)) {
    return " - ";
  }
  return (num >= 0 ? "+" : "") + num.toFixed(2);
}

export function InstructorCard({ ratings, term }: InstructorCardProps) {
  const [open, setOpen] = React.useState(false);

  const {
    meta: { name, courses },
  } = ratings;

  const score = ratings.score!;
  const rank = ratings.rank!;
  const percentile = ratings.percentile!;

  const r = Object.fromEntries(
    Criteria.flatMap((c) => {
      if (!ratings.ratings[c]) {
        return [];
      }
      return [
        [
          c,
          {
            rating: ratings.ratings[c].rating[term] ?? NaN,
            bayesian: ratings.ratings[c].bayesian[term] ?? NaN,
            confidence: ratings.ratings[c].confidence[term] ?? NaN,
            samples: _.sum(Object.values(ratings.ratings[c].samples)),
          },
        ],
      ];
    }),
  );

  // If any is undefined, there is no samples for that criterion.
  const usSamples = r["content"]?.samples ?? 0; // us: ust.space
  const sfqSamples = r["course"]?.samples ?? 0; // sfq: aqa.hkust.edu.hk/sfq

  const formattedScore = (score * 100).toFixed(1);

  const [familyName, ...givenNames] = name.split(", ");

  const googleUrl = new URL(
    "https://www.google.com/search?" +
      new URLSearchParams({
        q: `site:facultyprofiles.hkust.edu.hk ${name}`,
      }).toString(),
  ).toString();

  const currentCourses = useMemo(() => {
    return courses[term].map((c) => `${c.subject} ${c.code}`).sort(naturalSort);
  }, [courses, term]);
  const historicalCourses = useMemo(() => {
    const cs = Object.entries(courses)
      .filter(([t]) => Number(t) < term)
      .flatMap(([_, cs]) => cs)
      .map((c) => `${c.subject} ${c.code}`)
      .sort(naturalSort);
    return _.uniq(cs);
  }, [courses, term]);

  return (
    <Card
      className="flex cursor-pointer flex-col bg-white"
      onClick={() => setOpen(!open)}
    >
      <CardHeader className="flex w-full flex-row items-center gap-4 p-4 lg:p-6 lg:pr-10">
        <CardTitle className="shrink-0 text-gray-600 lg:w-36">
          #{rank}{" "}
          <span className="hidden font-medium lg:inline">
            ({formattedScore})
          </span>
        </CardTitle>
        <div className="min-w-0 space-y-1 text-left">
          <CardTitle className="tracking-normal">
            <a
              className="group pointer-events-none lg:pointer-events-auto"
              href={googleUrl}
              target="_blank"
              onClick={stopPropagation}
            >
              <span className="inline-block group-hover:underline">
                {familyName},&nbsp;
              </span>
              <span className="inline-block group-hover:underline">
                {givenNames.join(", ")}
              </span>
            </a>
          </CardTitle>
          <CardDescription className="truncate">
            <span className="font-semibold">{usSamples}</span> samples from
            ust.space. <span className="font-semibold">{sfqSamples}</span>{" "}
            samples from SFQ.
          </CardDescription>
        </div>
        <Card
          className="!my-auto !ml-auto w-12 shrink-0 py-2 text-white"
          style={{ backgroundColor: cssColor(gradeColor(percentile)) }}
        >
          <CardTitle>{letterGrade(percentile)}</CardTitle>
        </Card>
      </CardHeader>
      <Collapsible open={open}>
        <CollapsibleContent className="data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
          <CardContent>
            <div className="mx-6 mb-1 grid grid-cols-1 gap-2 text-left text-gray-500 lg:grid-cols-2">
              <table className="block w-fit whitespace-pre">
                <thead>
                  <tr>
                    <th className="px-2 py-1 pt-0 text-left">Criteria</th>
                    <th className="px-2 py-1 pt-0 text-left">Rating</th>
                    <th className="px-2 py-1 pt-0 text-left">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {Criteria.map((c) => (
                    <tr key={c}>
                      <td className="px-2 py-1 font-medium">
                        {CriteriaName[c].replace(" ", "\n")}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {formatNumber(r[c]?.rating)}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {formatNumber(r[c]?.confidence)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="grid auto-rows-min gap-2">
                {currentCourses.length > 0 ? (
                  <div>
                    <span className="font-medium">Current Courses Taught</span>
                    <div className="grid gap-x-2">
                      {currentCourses.map((it) => (
                        <span key={it} className="text-nowrap font-mono">
                          {it}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="font-medium">
                    Instructor does not teach in this term.
                  </span>
                )}
                <div>
                  <span className="font-medium">Historical Courses Taught</span>
                  <div className="grid gap-x-2">
                    {historicalCourses.map((it) => (
                      <span key={it} className="text-nowrap font-mono">
                        {it}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <InstructorTrendChart ratings={ratings} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
