export type RankingColor = [number, number, number];

export function letterGrade(percentile: number) {
  for (const [threshold, grade] of [
    [0.9, "A+"],
    [0.8, "A"],
    [0.75, "A-"],
    [0.6, "B+"],
    [0.45, "B"],
    [0.35, "B-"],
    [0.3, "C+"],
    [0.25, "C"],
    [0.2, "C-"],
    [0.1, "D"],
    [0, "F"],
  ] as Array<[number, string]>)
    if (percentile >= threshold) return grade;
  return "F";
}

export function gradeColor(ratio: number): RankingColor {
  const stops = [
    { ratio: 0, color: [237, 27, 47] as RankingColor },
    { ratio: 0.25, color: [250, 166, 26] as RankingColor },
    { ratio: 0.75, color: [163, 207, 98] as RankingColor },
    { ratio: 1, color: [0, 154, 97] as RankingColor },
  ];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];
    if (ratio < current.ratio || ratio > next.ratio) continue;
    const progress = (ratio - current.ratio) / (next.ratio - current.ratio);
    return current.color.map((channel, channelIndex) =>
      Math.round(
        channel * (1 - progress) + next.color[channelIndex] * progress,
      ),
    ) as RankingColor;
  }
  return [0, 0, 0];
}
