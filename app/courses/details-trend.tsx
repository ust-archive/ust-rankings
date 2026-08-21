"use client";

import { useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RankingCriterion } from "@/lib/rankings/configuration";

export type DetailTrendTerm = {
  termCode: string;
  termName: string;
  criteria: Partial<
    Record<RankingCriterion, { bayesian: number; samples: number }>
  >;
};

const criteria: Array<[RankingCriterion, string, string]> = [
  ["content", "Content", "#2563eb"],
  ["teaching", "Teaching", "#16a34a"],
  ["grading", "Grading", "#d97706"],
  ["workload", "Workload", "#dc2626"],
  ["course", "Course SFQ", "#9333ea"],
  ["instructor", "Instructor SFQ", "#0891b2"],
];

function valueLabel(value?: { bayesian: number; samples: number }) {
  return value
    ? `${value.bayesian.toFixed(2)} · ${value.samples} samples`
    : "Unavailable";
}

export function DetailsTrend({
  terms,
  selectedTermCode,
}: {
  terms: DetailTrendTerm[];
  selectedTermCode?: string;
}) {
  const [selectedCriteria, setSelectedCriteria] = useState<RankingCriterion[]>([
    "course",
  ]);
  const activeTerms = useMemo(
    () => terms.filter((term) => Object.keys(term.criteria).length > 0),
    [terms],
  );
  const values = activeTerms.flatMap((term) =>
    selectedCriteria.flatMap((criterion) => {
      const value = term.criteria[criterion]?.bayesian;
      return value === undefined ? [] : [value];
    }),
  );
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const range = Math.max(maximum - minimum, 0.5);
  const width = 720;
  const height = 220;
  const left = 42;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        aria-label="Trend criteria"
        className="flex-wrap justify-start"
        onValueChange={(value) =>
          setSelectedCriteria(value as RankingCriterion[])
        }
        type="multiple"
        value={selectedCriteria}
        variant="outline"
      >
        {criteria.map(([criterion, label, color]) => (
          <ToggleGroupItem key={criterion} value={criterion}>
            <span aria-hidden="true" style={{ color }}>
              ●
            </span>{" "}
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {activeTerms.length ? (
        <figure
          aria-label="Bayesian criterion values by Term"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3"
        >
          <svg
            aria-hidden="true"
            className="h-auto w-full"
            viewBox={`0 0 ${width} ${height}`}
          >
            {[0, 0.5, 1].map((step) => {
              const y = top + plotHeight * step;
              return (
                <g key={step}>
                  <line
                    stroke="#e2e8f0"
                    strokeDasharray="3 3"
                    x1={left}
                    x2={width - right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    fill="#64748b"
                    fontSize="11"
                    textAnchor="end"
                    x={left - 7}
                    y={y + 4}
                  >
                    {(maximum - range * step).toFixed(2)}
                  </text>
                </g>
              );
            })}
            {activeTerms.map((term, index) => {
              const x =
                left +
                (activeTerms.length === 1
                  ? plotWidth / 2
                  : (plotWidth * index) / (activeTerms.length - 1));
              const interval = Math.max(1, Math.ceil(activeTerms.length / 6));
              return index === 0 ||
                index === activeTerms.length - 1 ||
                index % interval === 0 ||
                term.termCode === selectedTermCode ? (
                <text
                  fill="#64748b"
                  fontSize="10"
                  key={term.termCode}
                  textAnchor="end"
                  transform={`rotate(-35 ${x} ${height - 5})`}
                  x={x}
                  y={height - 5}
                >
                  {term.termName}
                </text>
              ) : null;
            })}
            {selectedCriteria.map((criterion) => {
              const color =
                criteria.find(([value]) => value === criterion)?.[2] ??
                "#003366";
              const points = activeTerms
                .flatMap((term, index) => {
                  const value = term.criteria[criterion]?.bayesian;
                  if (value === undefined) return [];
                  const x =
                    left +
                    (activeTerms.length === 1
                      ? plotWidth / 2
                      : (plotWidth * index) / (activeTerms.length - 1));
                  const y = top + ((maximum - value) / range) * plotHeight;
                  return [`${x},${y}`];
                })
                .join(" ");
              return points ? (
                <polyline
                  fill="none"
                  key={criterion}
                  points={points}
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                />
              ) : null;
            })}
          </svg>
          <figcaption className="sr-only">
            Criterion values across available Terms. The table below contains
            every value and sample count.
          </figcaption>
        </figure>
      ) : (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          Trend history is unavailable because no criterion evidence was
          returned.
        </p>
      )}
      <section
        aria-label="Trend history table"
        className="overflow-x-auto rounded-xl border border-slate-200 bg-white"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the wide evidence table.
        tabIndex={0}
      >
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">Trend values by Term</caption>
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2" scope="col">
                Term
              </th>
              {criteria.map(([, label, color]) => (
                <th className="px-3 py-2" key={label} scope="col">
                  <span aria-hidden="true" style={{ color }}>
                    ●
                  </span>{" "}
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {terms.map((term) => (
              <tr
                className={
                  term.termCode === selectedTermCode
                    ? "border-t border-slate-200 bg-blue-50/60"
                    : "border-t border-slate-200"
                }
                key={term.termCode}
              >
                <th
                  className="whitespace-nowrap px-3 py-2 text-left font-semibold"
                  scope="row"
                >
                  {term.termName}
                  {term.termCode === selectedTermCode ? " · selected" : ""}
                </th>
                {criteria.map(([criterion]) => (
                  <td
                    className="whitespace-nowrap px-3 py-2 tabular-nums"
                    key={criterion}
                  >
                    {valueLabel(term.criteria[criterion])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
