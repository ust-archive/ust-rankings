import assert from "node:assert/strict";
import { test } from "vitest";
import {
  bundleTrajectories,
  jointOutcome,
  prediction,
  type WaitlistTrajectory,
} from "../src/waitlist-evidence.ts";

const trajectory = (
  section: string,
  type: string,
  waits: number[],
): WaitlistTrajectory => ({
  course: "COMP1000",
  events: waits.map((wait, index) => ({ at: index * 3_600_000, wait })),
  section,
  term: "2410",
  type,
  association: 1,
});

test("groups required Class types into one correlated Course Offering", () => {
  const bundles = bundleTrajectories([
    trajectory("L1", "LEC", [0, 30, 10]),
    trajectory("LA1", "LAB", [0, 12, 2]),
  ]);
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0]?.pattern, "LAB+LEC");
  assert.deepEqual(
    bundles[0]?.components.map((item) => item.type),
    ["LAB", "LEC"],
  );
});

test("joint outcome requires every selected component to clear its position", () => {
  const [bundle] = bundleTrajectories([
    trajectory("L1", "LEC", [0, 30, 10]),
    trajectory("LA1", "LAB", [0, 12, 2]),
  ]);
  if (!bundle) throw new Error("fixture bundle missing");
  assert.equal(
    jointOutcome(bundle, { LAB: 11, LEC: 20 }, { LAB: 0, LEC: 0 })?.success,
    false,
  );
  assert.equal(
    jointOutcome(bundle, { LAB: 5, LEC: 20 }, { LAB: 0, LEC: 0 })?.success,
    true,
  );
});

test("sparse joint evidence is smoothed toward the component-pattern prior", () => {
  const favorable = bundleTrajectories([
    trajectory("L1", "LEC", [0, 30, 0]),
    trajectory("LA1", "LAB", [0, 12, 0]),
  ])[0];
  const unfavorable = bundleTrajectories([
    trajectory("L2", "LEC", [0, 30, 25]),
    trajectory("LA2", "LAB", [0, 12, 10]),
  ])[0];
  if (!favorable || !unfavorable) throw new Error("fixture bundle missing");
  const result = prediction(
    [favorable, unfavorable],
    {
      course: "COMP1000",
      pattern: "LAB+LEC",
      season: "Fall",
      positions: { LAB: 5, LEC: 20 },
      activationHours: { LAB: 0, LEC: 0 },
    },
    "baseline",
    4,
  );
  assert.equal(result?.local.length, 2);
  assert.equal(result?.priorSamples, 2);
  assert.equal(result?.successes, 1);
  assert.equal(result?.estimate, 0.5);
});
