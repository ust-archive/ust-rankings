export const RANKING_CRITERIA = [
  "content",
  "teaching",
  "grading",
  "workload",
  "course",
  "instructor",
] as const;

export type RankingCriterion = (typeof RANKING_CRITERIA)[number];

export const RANKING_CRITERION_LABELS: Record<RankingCriterion, string> = {
  content: "Content",
  teaching: "Teaching",
  grading: "Grading",
  workload: "Workload",
  course: "Course SFQ",
  instructor: "Instructor SFQ",
};
