export type DistributionSummary = {
  low: number;
  lq?: number;
  median?: number;
  mean?: number;
  uq?: number;
  high: number;
  standardDeviation?: number;
};

export type FittedDistribution = {
  alpha: number;
  beta: number;
  mean: number;
  standardDeviation: number;
  points: { score: number; density: number }[];
  percentile: (score: number) => number;
  maxQuantileError: number;
};

// Stirling expansion after shifting into its accurate range: https://dlmf.nist.gov/5.11.E1
function logGamma(value: number): number {
  let x = value;
  let shift = 0;
  while (x < 12) {
    shift -= Math.log(x);
    x += 1;
  }
  const inverse = 1 / x;
  const square = inverse * inverse;
  return (
    shift +
    (x - 0.5) * Math.log(x) -
    x +
    Math.log(2 * Math.PI) / 2 +
    inverse *
      (1 / 12 +
        square *
          (-1 / 360 +
            square * (1 / 1260 + square * (-1 / 1680 + square / 1188))))
  );
}

// Regularized incomplete beta, continued fraction and symmetry:
// https://dlmf.nist.gov/8.17.E22 and https://dlmf.nist.gov/8.17.E4
function betaCdf(alpha: number, beta: number) {
  const logBeta = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
  return (value: number): number => {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    const reflect = value > (alpha + 1) / (alpha + beta + 2);
    const x = reflect ? 1 - value : value;
    const a = reflect ? beta : alpha;
    const b = reflect ? alpha : beta;
    const safe = (n: number) => (Math.abs(n) < 1e-300 ? 1e-300 : n);
    let c = 1;
    let d = 1 / safe(1 - ((a + b) * x) / (a + 1));
    let fraction = d;
    for (let m = 1; m <= 1000; m += 1) {
      const even = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
      d = 1 / safe(1 + even * d);
      c = safe(1 + even / c);
      fraction *= d * c;
      const odd =
        -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 / safe(1 + odd * d);
      c = safe(1 + odd / c);
      const change = d * c;
      fraction *= change;
      if (Math.abs(change - 1) < 1e-12) break;
    }
    const probability =
      (Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta) * fraction) / a;
    return Math.max(0, Math.min(1, reflect ? 1 - probability : probability));
  };
}

function betaQuantile(cdf: (score: number) => number, probability: number) {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (cdf(middle) < probability) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

export function fitDistribution(
  summary: DistributionSummary,
): FittedDistribution {
  const { low, lq, median, mean, uq, high, standardDeviation } = summary;
  if (
    ![low, high].every(Number.isFinite) ||
    ![lq, median, mean, uq, standardDeviation].every(
      (value) => value === undefined || Number.isFinite(value),
    )
  ) {
    throw new Error("Enter a finite number for each statistic.");
  }
  const range = high - low;
  if (!(range > 0) || !Number.isFinite(range)) {
    throw new Error("The high score must be greater than the low score.");
  }
  const quartiles = [
    { score: lq, probability: 0.25 },
    { score: median, probability: 0.5 },
    { score: uq, probability: 0.75 },
  ]
    .filter((quartile) => quartile.score !== undefined)
    .map(({ score, probability }) => ({
      value: ((score as number) - low) / range,
      probability,
    }));
  if (
    quartiles.some(
      ({ value }, index) =>
        value < 0 ||
        value > 1 ||
        (index > 0 && value < quartiles[index - 1].value),
    )
  ) {
    throw new Error(
      "Use low ≤ lower quartile ≤ median ≤ upper quartile ≤ high.",
    );
  }
  const normalizedMean = mean === undefined ? undefined : (mean - low) / range;
  if (
    normalizedMean !== undefined &&
    !(normalizedMean > 0 && normalizedMean < 1)
  ) {
    throw new Error("The mean must be between the low and high scores.");
  }
  let lowerMean = 0;
  let upperMean = 0;
  let previous = { value: 0, probability: 0 };
  for (const quartile of [...quartiles, { value: 1, probability: 1 }]) {
    const width = quartile.probability - previous.probability;
    lowerMean += width * previous.value;
    upperMean += width * quartile.value;
    previous = quartile;
  }
  if (
    normalizedMean !== undefined &&
    (normalizedMean < lowerMean - 1e-12 || normalizedMean > upperMean + 1e-12)
  ) {
    throw new Error(
      "The mean is inconsistent with the quartiles and score range.",
    );
  }
  const normalizedSd =
    standardDeviation === undefined ? undefined : standardDeviation / range;
  if (
    normalizedSd !== undefined &&
    (!(normalizedSd > 0) ||
      normalizedSd >=
        (normalizedMean === undefined
          ? 0.5
          : Math.sqrt(normalizedMean * (1 - normalizedMean))))
  ) {
    throw new Error(
      "The standard deviation must be positive and smaller than the limit allowed by the mean and score range.",
    );
  }
  if (
    quartiles.length < 2 &&
    (normalizedMean === undefined || normalizedSd === undefined)
  ) {
    throw new Error(
      "Enter a mean and standard deviation, or at least two quartiles (lower quartile, median, upper quartile).",
    );
  }

  const loss = (logAlpha: number, logBeta: number): number => {
    // ponytail: bounded search suits grade summaries; use a statistics library for extreme shapes.
    if (logAlpha < -7 || logBeta < -7 || logAlpha > 12 || logBeta > 12) {
      return Number.POSITIVE_INFINITY;
    }
    const a = Math.exp(logAlpha);
    const b = Math.exp(logBeta);
    const cdf = betaCdf(a, b);
    const modeledMean = a / (a + b);
    const modeledSd = Math.sqrt(
      (modeledMean * (1 - modeledMean)) / (a + b + 1),
    );
    return (
      quartiles.reduce(
        // Score-space errors preserve the information in tied and boundary quartiles.
        (sum, { value, probability }) =>
          sum + (betaQuantile(cdf, probability) - value) ** 2,
        0,
      ) +
      (normalizedMean === undefined
        ? 0
        : 2 * (modeledMean - normalizedMean) ** 2) +
      (normalizedSd === undefined ? 0 : 2 * (modeledSd - normalizedSd) ** 2)
    );
  };
  const initialMean =
    normalizedMean ??
    quartiles.find(({ probability }) => probability === 0.5)?.value ??
    (quartiles[0].value + quartiles[quartiles.length - 1].value) / 2;
  const initialSd =
    normalizedSd ??
    Math.max(
      ((quartiles[quartiles.length - 1].value - quartiles[0].value) /
        (quartiles[quartiles.length - 1].probability -
          quartiles[0].probability)) *
        (0.5 / 1.35),
      0.001,
    );
  const concentration = Math.max(
    0.01,
    (initialMean * (1 - initialMean)) / initialSd ** 2 - 1,
  );
  let best = { a: 0, b: 0, loss: Number.POSITIVE_INFINITY };
  const momentsOnly = quartiles.length === 0;
  const starts = momentsOnly ? [] : [0.2, 2, concentration, 100];
  for (const start of starts) {
    let a = Math.log(Math.max(0.001, Math.min(100000, initialMean * start)));
    let b = Math.log(
      Math.max(0.001, Math.min(100000, (1 - initialMean) * start)),
    );
    let currentLoss = loss(a, b);
    let step = 1;
    for (let iteration = 0; iteration < 350 && step > 1e-6; iteration += 1) {
      let next = { a, b, loss: currentLoss };
      for (const da of [-step, 0, step]) {
        for (const db of [-step, 0, step]) {
          if (da === 0 && db === 0) continue;
          const candidateLoss = loss(a + da, b + db);
          if (candidateLoss < next.loss) {
            next = { a: a + da, b: b + db, loss: candidateLoss };
          }
        }
      }
      if (next.loss < currentLoss) {
        a = next.a;
        b = next.b;
        currentLoss = next.loss;
      } else {
        step /= 2;
      }
    }
    if (currentLoss < best.loss) best = { a, b, loss: currentLoss };
  }
  // With only mean and SD, method of moments identifies the beta exactly.
  const exactConcentration =
    (initialMean * (1 - initialMean)) / initialSd ** 2 - 1;
  const alpha = momentsOnly
    ? initialMean * exactConcentration
    : Math.exp(best.a);
  const beta = momentsOnly
    ? (1 - initialMean) * exactConcentration
    : Math.exp(best.b);
  if (
    !Number.isFinite(alpha) ||
    !Number.isFinite(beta) ||
    alpha < Math.exp(-7) ||
    beta < Math.exp(-7) ||
    alpha > Math.exp(12) ||
    beta > Math.exp(12)
  ) {
    throw new Error(
      "These statistics require a more extreme beta shape than this tool supports.",
    );
  }
  const cdf = betaCdf(alpha, beta);
  const modeledMean = alpha / (alpha + beta);
  const binCount = 240;
  const points = Array.from({ length: binCount + 1 }, (_, index) => {
    const x = index / binCount;
    const left = Math.max(0, x - 0.5 / binCount);
    const right = Math.min(1, x + 0.5 / binCount);
    // Average over a narrow interval so endpoint singularities stay finite.
    const density = (cdf(right) - cdf(left)) / (right - left) / range;
    return {
      score: low + x * range,
      density: Math.min(Number.MAX_VALUE, Math.max(0, density)),
    };
  });
  return {
    alpha,
    beta,
    mean: low + modeledMean * range,
    standardDeviation:
      range * Math.sqrt((modeledMean * (1 - modeledMean)) / (alpha + beta + 1)),
    points,
    percentile: (score) => {
      if (!Number.isFinite(score)) throw new Error("Enter a finite score.");
      return cdf((score - low) / range);
    },
    maxQuantileError:
      range *
      Math.max(
        0,
        ...quartiles.map(({ value, probability }) =>
          Math.abs(betaQuantile(cdf, probability) - value),
        ),
      ),
  };
}
