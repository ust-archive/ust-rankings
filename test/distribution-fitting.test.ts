import { expect, test } from "vitest";
import {
  type DistributionSummary,
  fitDistribution,
} from "@/lib/tools/distribution";

const uniform: DistributionSummary = {
  low: 0,
  lq: 25,
  median: 50,
  mean: 50,
  uq: 75,
  high: 100,
};

test("fits mean and SD alone exactly without inventing missing quartiles", () => {
  const fitted = fitDistribution({
    low: 0,
    high: 100,
    mean: 200 / 3,
    standardDeviation: 100 / Math.sqrt(18),
  });
  expect(fitted.alpha).toBeCloseTo(2, 12);
  expect(fitted.beta).toBeCloseTo(1, 12);
  expect(fitted.mean).toBeCloseTo(200 / 3, 12);
  expect(fitted.standardDeviation).toBeCloseTo(100 / Math.sqrt(18), 12);
  expect(fitted.percentile(30)).toBeCloseTo(0.09, 10);
  expect(fitted.maxQuantileError).toBe(0);
});

test.each([
  { lq: 25, median: 50 },
  { median: 50, uq: 75 },
  { lq: 25, uq: 75 },
])("fits any pair of quartiles without mean or SD: %j", (quartiles) => {
  const fitted = fitDistribution({ low: 0, high: 100, ...quartiles });
  expect(fitted.alpha).toBeCloseTo(1, 3);
  expect(fitted.beta).toBeCloseTo(1, 3);
  expect(fitted.mean).toBeCloseTo(50, 3);
  expect(fitted.percentile(80)).toBeCloseTo(0.8, 4);
});

test("accepts optional SD with quartiles when the mean is absent", () => {
  const fitted = fitDistribution({
    low: 0,
    high: 100,
    lq: 32.63518223330696,
    uq: 67.36481776669304,
    standardDeviation: Math.sqrt(500),
  });
  expect(fitted.alpha).toBeCloseTo(2, 3);
  expect(fitted.beta).toBeCloseTo(2, 3);
});

test.each([
  {},
  { mean: 50 },
  { standardDeviation: 10 },
  { lq: 25 },
  { median: 50, mean: 50 },
  { lq: undefined, median: 50, uq: undefined },
])("explains insufficient information for %j", (statistics) => {
  expect(() => fitDistribution({ low: 0, high: 100, ...statistics })).toThrow(
    /mean and standard deviation, or at least two quartiles/,
  );
});

test("checks only the supplied quartiles and their available mean bounds", () => {
  expect(() => fitDistribution({ low: 0, high: 100, lq: 80, uq: 60 })).toThrow(
    /quartile/,
  );
  expect(() =>
    fitDistribution({ low: 0, high: 100, median: -1, uq: 60 }),
  ).toThrow(/quartile/);
  expect(() =>
    fitDistribution({ low: 0, high: 100, lq: 25, median: 50, mean: 5 }),
  ).toThrow(/inconsistent/);
  expect(() =>
    fitDistribution({
      low: 0,
      high: 100,
      median: 50,
      mean: 90,
      standardDeviation: 5,
    }),
  ).toThrow(/inconsistent/);
  expect(() =>
    fitDistribution({
      low: 0,
      high: 100,
      lq: 25,
      uq: 75,
      standardDeviation: 51,
    }),
  ).toThrow(/standard deviation/);
});

test("recovers uniform percentiles and respects any score scale", () => {
  const fitted = fitDistribution(uniform);
  expect(fitted.alpha).toBeCloseTo(1, 3);
  expect(fitted.beta).toBeCloseTo(1, 3);
  expect(fitted.percentile(80)).toBeCloseTo(0.8, 4);
  expect(fitted.percentile(-1)).toBe(0);
  expect(fitted.percentile(101)).toBe(1);
  expect(fitted.maxQuantileError).toBeLessThan(0.01);
  const shifted = fitDistribution({
    low: -2,
    lq: -1,
    median: 0,
    mean: 0,
    uq: 1,
    high: 2,
  });
  expect(shifted.percentile(1.2)).toBeCloseTo(fitted.percentile(80), 6);
});

test("fits a skew beta from quartiles and its optional standard deviation", () => {
  // Beta(2, 1) has CDF x², mean 2/3, and variance 1/18.
  const fitted = fitDistribution({
    low: 0,
    lq: 50,
    median: 100 * Math.SQRT1_2,
    mean: 200 / 3,
    uq: 100 * Math.sqrt(0.75),
    high: 100,
    standardDeviation: 100 / Math.sqrt(18),
  });
  expect(fitted.alpha).toBeCloseTo(2, 3);
  expect(fitted.beta).toBeCloseTo(1, 3);
  expect(fitted.percentile(30)).toBeCloseTo(0.09, 5);
  expect(fitted.percentile(90)).toBeCloseTo(0.81, 5);
  expect(fitted.mean).toBeCloseTo(200 / 3, 3);
  expect(fitted.standardDeviation).toBeCloseTo(100 / Math.sqrt(18), 3);
});

test("uses quartiles even when the mean is unchanged and SD is omitted", () => {
  const wide = fitDistribution(uniform);
  // Beta(2,2) CDF is 3x² - 2x³.
  const narrow = fitDistribution({
    ...uniform,
    lq: 32.63518223330696,
    uq: 67.36481776669304,
  });
  expect(narrow.alpha).toBeCloseTo(2, 3);
  expect(narrow.beta).toBeCloseTo(2, 3);
  expect(narrow.percentile(20)).toBeCloseTo(0.104, 5);
  expect(narrow.standardDeviation).toBeLessThan(wide.standardDeviation);
  expect(narrow.maxQuantileError).toBeLessThan(0.01);
});

test("optional SD participates in an approximate fit with inconsistent summaries", () => {
  const withoutSd = fitDistribution(uniform);
  const withSd = fitDistribution({ ...uniform, standardDeviation: 12 });
  expect(withSd.standardDeviation).toBeLessThan(
    withoutSd.standardDeviation - 1,
  );
  expect(withSd.maxQuantileError).toBeGreaterThan(0.1);
});

test("supports U-shaped curves and keeps their endpoints finite", () => {
  // Beta(1/2,1/2) is the arcsine distribution, with quantile sin²(πp/2).
  const fitted = fitDistribution({
    ...uniform,
    lq: 100 * Math.sin(Math.PI / 8) ** 2,
    uq: 100 * Math.sin((3 * Math.PI) / 8) ** 2,
    standardDeviation: 100 / Math.sqrt(8),
  });
  expect(fitted.alpha).toBeCloseTo(0.5, 3);
  expect(fitted.beta).toBeCloseTo(0.5, 3);
  expect(fitted.percentile(10)).toBeCloseTo(
    (2 * Math.asin(Math.sqrt(0.1))) / Math.PI,
    5,
  );
  expect(
    fitted.points.every(
      ({ score, density }) =>
        Number.isFinite(score) && Number.isFinite(density) && density >= 0,
    ),
  ).toBe(true);
  expect(fitted.points[0].density).toBeGreaterThan(fitted.points[120].density);
  const area = fitted.points.slice(1).reduce((sum, point, index) => {
    const previous = fitted.points[index];
    return (
      sum +
      ((point.density + previous.density) / 2) * (point.score - previous.score)
    );
  }, 0);
  expect(area).toBeCloseTo(1, 8);
});

test("tied central quartiles fit a concentrated center rather than arbitrary tails", () => {
  const fitted = fitDistribution({ ...uniform, lq: 50, uq: 50 });
  expect(fitted.mean).toBeCloseTo(50, 2);
  expect(fitted.standardDeviation).toBeLessThan(1);
  expect(fitted.maxQuantileError).toBeLessThan(1);
  expect(fitted.percentile(50)).toBeCloseTo(0.5, 3);
  expect(fitted.percentile(75)).toBeGreaterThan(0.99);
  expect(fitted.points[120].density).toBeGreaterThan(fitted.points[0].density);
  const percentiles = Array.from({ length: 101 }, (_, score) =>
    fitted.percentile(score),
  );
  expect(
    percentiles.every(
      (value, index) =>
        value >= 0 &&
        value <= 1 &&
        (index === 0 || value >= percentiles[index - 1]),
    ),
  ).toBe(true);
});

test("quartiles tied at a bound constrain the fit beyond just its mean", () => {
  const atLow = fitDistribution({
    ...uniform,
    lq: 0,
    median: 0,
    uq: 0,
    mean: 10,
  });
  const atHigh = fitDistribution({
    ...uniform,
    lq: 100,
    median: 100,
    uq: 100,
    mean: 90,
  });
  expect(atLow.maxQuantileError).toBeLessThan(3);
  expect(atHigh.maxQuantileError).toBeLessThan(3);
  expect(atLow.percentile(10)).toBeGreaterThan(0.75);
  expect(atHigh.percentile(90)).toBeLessThan(0.25);
  expect(atLow.percentile(25)).toBeCloseTo(1 - atHigh.percentile(75), 2);
});

test.each([
  [{ high: 0 }, /high score/],
  [{ mean: 0 }, /mean must/],
  [{ lq: 70 }, /quartile/],
  [{ mean: 10 }, /inconsistent/],
  [{ standardDeviation: 0 }, /standard deviation/],
  [{ standardDeviation: 50 }, /standard deviation/],
  [{ standardDeviation: Number.NaN }, /finite/],
  [{ median: Number.POSITIVE_INFINITY }, /finite/],
] as const)("rejects invalid summary %j", (changes, error) => {
  expect(() => fitDistribution({ ...uniform, ...changes })).toThrow(error);
});

test("rejects a non-finite score", () => {
  expect(() => fitDistribution(uniform).percentile(Number.NaN)).toThrow(
    /finite score/,
  );
});
