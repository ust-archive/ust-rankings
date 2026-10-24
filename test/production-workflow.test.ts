import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("one queued production writer builds paired data before deploying the same CI run image", async () => {
  const workflow = await readFile(".github/workflows/update-data.yml", "utf8");
  expect(existsSync(".github/workflows/deploy.yml")).toBe(false);
  expect(workflow).toContain("    branches: [master]");
  expect(workflow).not.toMatch(/^concurrency:/m);
  expect(workflow).toMatch(
    / {4}concurrency:\n {6}group: production-publish\n {6}queue: max\n {6}cancel-in-progress: false/,
  );
  const steps = workflow.split(/^ {6}- /m).slice(1);
  const find = (name: string) => steps.findIndex((step) => step.includes(name));
  const order = [
    "Verify tested checkout is current master",
    "Build full-fidelity Ranking archive",
    "Publish full-fidelity Ranking archive",
    "Build paired Delivery Dataset and Server Index",
    "Download image digest from CI",
    "Deploy verified image",
    "Mirror, activate, and promote",
  ];
  const indices = order.map(find);
  expect(indices.every((index) => index >= 0)).toBe(true);
  expect(indices).toEqual([...indices].sort((a, b) => a - b));
  expect(steps[find("Download image digest from CI")]).toMatch(
    /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/,
  );
  for (const name of [
    "Download image digest from CI",
    "Create image app spec",
    "Deploy verified image",
  ])
    expect(steps[find(name)]).toContain("github.event_name == 'workflow_run'");
  for (const name of [
    "Publish full-fidelity Ranking archive",
    "Publish derived generation",
    "Deploy verified image",
  ])
    expect(steps[find(name)]).toContain(
      'node scripts/check-publication-head.ts "$PUBLISH_SHA"',
    );
  for (const step of steps.filter(
    (step) =>
      step.includes("uvx hf upload") ||
      step.includes("doctl apps update") ||
      step.includes("publish-delivery.ts publish"),
  ))
    expect(step).toContain("env.PUBLICATION_STALE != 'true'");
  expect(workflow).toContain("github.ref == 'refs/heads/master'");
  const rollback = steps[find("Roll back Server Index and Delivery pointer")];
  expect(rollback).toContain("inputs.action == 'rollback'");
  expect(rollback).not.toContain("steps.head.outputs.current");
});
