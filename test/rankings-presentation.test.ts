import { describe, expect, test } from "vitest";
import { histogramPercentiles } from "@/lib/rankings/presentation";

describe("histogramPercentiles", () => {
  test("colors score bins by cumulative population", () => {
    expect(histogramPercentiles([1, 3, 0, 6], 10)).toEqual([0.1, 0.4, 0.4, 1]);
  });
});
