// Read the archived development artifact; do not acquire or fit new observations.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = JSON.parse(
  await readFile(
    new URL("./course-instructor-negative-control.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(report.developmentOnly, true);
assert.equal(report.productionPromotion, false);
assert.equal(report.maximumTerm, 102);
assert.equal(report.shuffled.length, 10);
const real = report.original.originalDevelopment;
const betterShuffles = report.shuffled.filter(
  (run: { metrics: { originalDevelopment: { residual: number } } }) =>
    run.metrics.originalDevelopment.residual < real.residual,
).length;
assert.equal(betterShuffles, 10);
console.log(
  JSON.stringify(
    {
      evidence: "Archived retrospective artifact; no new statistical run",
      before: { residualGainOverCourse: real.residualGain },
      after: {
        residualGainOverPopulation: real.residualGainOverPopulation,
        shufflesWithLowerResidualError: betterShuffles,
        sourceFragmentMaximumDifference:
          report.sourceFragmentSplit.maximumCanonicalNumericDifference,
      },
      productionPromotion: false,
    },
    null,
    2,
  ),
);
