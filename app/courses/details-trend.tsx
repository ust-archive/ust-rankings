"use client";

import { useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RankingCriterion } from "@/lib/rankings/configuration";

export type DetailTrendTerm = {
  termCode: string;
  termName: string;
  criteria: Partial<
    Record<
      RankingCriterion,
      {
        bayesian: number;
        confidence: number;
        samples: number;
        cumulativeSamples: number;
      }
    >
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

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-US");

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
  const minimum = values.length ? Math.min(0, ...values) : 0;
  const maximum = values.length ? Math.max(0, ...values) : 1;
  const range = Math.max(maximum - minimum, 0.5);
  const width = 720;
  const height = 250;
  const left = 42;
  const right = 16;
  const top = 16;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const averageY = top + (maximum / range) * plotHeight;
  const labelInterval = Math.max(1, Math.ceil((activeTerms.length - 1) / 5));
  const minimumLabelGap = labelInterval;
  const selectedIndex = activeTerms.findIndex(
    (term) => term.termCode === selectedTermCode,
  );
  const labelIndexes = new Set<number>();
  for (const index of [selectedIndex, 0, activeTerms.length - 1])
    if (
      index >= 0 &&
      [...labelIndexes].every(
        (current) => Math.abs(current - index) >= minimumLabelGap,
      )
    )
      labelIndexes.add(index);
  for (
    let index = labelInterval;
    index < activeTerms.length;
    index += labelInterval
  )
    if (
      [...labelIndexes].every(
        (current) => Math.abs(current - index) >= minimumLabelGap,
      )
    )
      labelIndexes.add(index);

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        aria-label="History criteria"
        className="flex-wrap justify-start"
        onValueChange={(value) => {
          if (value.length) setSelectedCriteria(value as RankingCriterion[]);
        }}
        type="multiple"
        value={selectedCriteria}
        variant="outline"
      >
        {criteria.map(([criterion, label, color]) => (
          <ToggleGroupItem className="gap-2" key={criterion} value={criterion}>
            <span aria-hidden="true" style={{ color }}>
              ●
            </span>
            <span>{label}</span>
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
            <line
              data-average-line=""
              stroke="#475569"
              strokeWidth="1.5"
              x1={left}
              x2={width - right}
              y1={averageY}
              y2={averageY}
            />
            <text
              fill="#475569"
              fontSize="10"
              textAnchor="end"
              x={width - right - 4}
              y={Math.max(top + 11, averageY - 5)}
            >
              Average (0)
            </text>
            {activeTerms.map((term, index) => {
              const x =
                left +
                (activeTerms.length === 1
                  ? plotWidth / 2
                  : (plotWidth * index) / (activeTerms.length - 1));
              return labelIndexes.has(index) ? (
                <text
                  fill="#64748b"
                  fontSize="10"
                  key={term.termCode}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === activeTerms.length - 1
                        ? "end"
                        : "middle"
                  }
                  x={x}
                  y={height - 9}
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
            Criterion values by Term. Zero is the population average.
          </figcaption>
        </figure>
      ) : (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          History is unavailable because no criterion evidence was returned.
        </p>
      )}
      <section
        aria-label="History table"
        className="overflow-x-auto rounded-xl border border-slate-200 bg-white"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the evidence table.
        tabIndex={0}
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Criterion values by Term</caption>
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2" scope="col">
                Term
              </th>
              {selectedCriteria.map((criterion) => {
                const [, label, color] = criteria.find(
                  ([value]) => value === criterion,
                ) as [RankingCriterion, string, string];
                return (
                  <th className="px-3 py-2" key={criterion} scope="col">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" style={{ color }}>
                        ●
                      </span>
                      {label}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {[...terms].reverse().map((term) => (
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
                {selectedCriteria.map((criterion) => {
                  const value = term.criteria[criterion];
                  return (
                    <td
                      className="whitespace-nowrap px-3 py-2 tabular-nums"
                      key={criterion}
                    >
                      {value ? (
                        <>
                          <span className="font-medium">
                            {value.bayesian.toFixed(2)}
                          </span>
                          <span className="block text-xs text-slate-600">
                            Confidence {number.format(value.confidence)} ·{" "}
                            {count.format(value.samples)} new ·{" "}
                            {count.format(value.cumulativeSamples)} cumulative
                          </span>
                        </>
                      ) : (
                        "Unavailable"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
