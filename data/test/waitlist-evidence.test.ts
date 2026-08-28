import assert from "node:assert/strict";
import { test } from "vitest";
import {
  activationAt,
  bundleTrajectories,
  jointOutcome,
  prediction,
  tuneJoint,
  WAITLIST_TERMS,
  type WaitlistTrajectory,
} from "../src/waitlist-evidence.ts";

const trajectory = (
  section: string,
  type: string,
  waits: number[],
  term = "2410",
): WaitlistTrajectory => ({
  course: "COMP1000",
  events: waits.map((wait, index) => ({
    at:
      Date.parse(
        WAITLIST_TERMS[term as keyof typeof WAITLIST_TERMS].enrollmentStart,
      ) +
      index * 3_600_000,
    wait,
  })),
  section,
  term,
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

test("Queue Activation ignores pre-enrollment wait", () => {
  const enrollmentStart = Date.parse(WAITLIST_TERMS["2410"].enrollmentStart);
  const sample: WaitlistTrajectory = {
    ...trajectory("L1", "LEC", [], "2410"),
    events: [
      { at: enrollmentStart - 3_600_000, wait: 20 },
      { at: enrollmentStart, wait: 20 },
      { at: enrollmentStart + 3_600_000, wait: 15 },
    ],
  };
  assert.equal(activationAt(sample), enrollmentStart);
});

test("joint outcome requires every selected component to clear its position", () => {
  const [bundle] = bundleTrajectories([
    trajectory("L1", "LEC", [0, 30, 10]),
    trajectory("LA1", "LAB", [0, 12, 2]),
  ]);
  if (!bundle) throw new Error("fixture bundle missing");
  assert.equal(
    jointOutcome(bundle, {
      components: [
        { section: "L1", type: "LEC", position: 20, activationHours: 0 },
        { section: "LA1", type: "LAB", position: 11, activationHours: 0 },
      ],
    })?.success,
    false,
  );
  assert.equal(
    jointOutcome(bundle, {
      components: [
        { section: "L1", type: "LEC", position: 20, activationHours: 0 },
        { section: "LA1", type: "LAB", position: 5, activationHours: 0 },
      ],
    })?.success,
    true,
  );
});

test("distinct Classes with the same component type remain separate", () => {
  const [bundle] = bundleTrajectories([
    trajectory("L1", "LEC", [0, 30, 10]),
    trajectory("L2", "LEC", [0, 25, 0]),
  ]);
  if (!bundle) throw new Error("fixture bundle missing");
  assert.equal(bundle.pattern, "LEC+LEC");
  assert.deepEqual(
    bundle.components.map(({ trajectory: item }) => item.section),
    ["L1", "L2"],
  );
  assert.equal(
    jointOutcome(bundle, {
      components: [
        { section: "A1", type: "LEC", position: 20, activationHours: 0 },
        { section: "A2", type: "LEC", position: 20, activationHours: 0 },
      ],
    })?.success,
    true,
  );
  assert.equal(
    jointOutcome(bundle, {
      components: [
        { section: "A1", type: "LEC", position: 25, activationHours: 0 },
        { section: "A2", type: "LEC", position: 20, activationHours: 0 },
      ],
    })?.success,
    false,
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
      components: [
        { section: "L1", type: "LEC", position: 20, activationHours: 0 },
        { section: "LA1", type: "LAB", position: 5, activationHours: 0 },
      ],
      course: "COMP1000",
      pattern: "LAB+LEC",
      season: "Fall",
    },
    "baseline",
    4,
  );
  assert.equal(result?.local.length, 2);
  assert.equal(result?.priorSamples, 2);
  assert.equal(result?.successes, 1);
  assert.equal(result?.estimate, 0.5);
  assert.deepEqual(
    result?.historyLevels.map(({ id, offerings, samples }) => ({
      id,
      offerings,
      samples,
    })),
    [
      {
        id: "course-pattern-season-timing",
        offerings: 2,
        samples: 2,
      },
      { id: "course-pattern-timing", offerings: 2, samples: 2 },
      { id: "pattern-season-timing", offerings: 2, samples: 2 },
      { id: "pattern-timing", offerings: 2, samples: 2 },
      { id: "pattern", offerings: 2, samples: 2 },
    ],
  );
});

test("completed Terms can be validated without changing production parameters", () => {
  const completed = (term: string, finalWait: number): WaitlistTrajectory => ({
    ...trajectory("L1", "LEC", [], term),
    events: [
      {
        at: Date.parse(
          WAITLIST_TERMS[term as keyof typeof WAITLIST_TERMS].enrollmentStart,
        ),
        wait: 0,
      },
      {
        at:
          Date.parse(
            WAITLIST_TERMS[term as keyof typeof WAITLIST_TERMS].enrollmentStart,
          ) + 3_600_000,
        wait: 60,
      },
      {
        at:
          Date.parse(
            WAITLIST_TERMS[term as keyof typeof WAITLIST_TERMS].enrollmentStart,
          ) +
          100 * 3_600_000,
        wait: finalWait,
      },
    ],
  });
  const bundles = bundleTrajectories([
    completed("2410", 0),
    completed("2510", 5),
  ]);
  const result = tuneJoint(bundles, "baseline", ["2510"]);
  assert.equal(result.total > 0, true);
  assert.equal(result.scores.length, 7);
});
