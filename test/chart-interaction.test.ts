import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

for (const chart of [
  "app/course/course-trend-chart.tsx",
  "app/instructor-trend-chart.tsx",
]) {
  test(`${chart} protects its full chart surface from card click bubbling`, async () => {
    const source = await Bun.file(resolve(root, chart)).text();

    expect(source).toContain(
      '<div className="py-4" onClick={stopPropagation}>',
    );
  });
}
