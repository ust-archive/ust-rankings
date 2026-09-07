import type {
  InstructorAssociationCorrection,
  InstructorIdentifierHistory,
  InstructorIdentityHistoryEvent,
} from "@/lib/instructor-identity";
import type { RankingCriterion } from "@/lib/rankings/configuration";
import type { RankingPreset, RankingWeights } from "@/lib/rankings/scoring";

export type { RankingPreset, RankingWeights } from "@/lib/rankings/scoring";

export type CommonCoreScheme = "4Y" | "CC22" | "CC25" | "CC26";
export type CommonCoreCategory =
  | "ssc-humanities"
  | "ssc-social-analysis"
  | "ssc-science-technology"
  | "humanities"
  | "social-analysis"
  | "science-technology"
  | "quantitative-reasoning"
  | "arts"
  | "english-communication"
  | "chinese-communication"
  | "health"
  | "critical-thinking-data-literacy"
  | "healthy-lifestyle-mindfulness-well-being"
  | "science"
  | "technology"
  | "sustainability"
  | "haic"
  | "undergraduate-research"
  | "undergraduate-teaching"
  | "undergraduate-participation"
  | "undergraduate-community";

type CommonCoreCategoryDefinition = {
  value: CommonCoreCategory;
  label: string;
  attributeValue: string;
};

export type CommonCoreSchemeDefinition = {
  value: CommonCoreScheme;
  label: string;
  categories: ReadonlyArray<CommonCoreCategoryDefinition>;
};

const opportunities: ReadonlyArray<
  Omit<CommonCoreCategoryDefinition, "attributeValue">
> = [
  { value: "undergraduate-research", label: "UxOP-UROP" },
  { value: "undergraduate-teaching", label: "UxOP-UTOP" },
  { value: "undergraduate-participation", label: "UxOP-UPOP" },
  { value: "undergraduate-community", label: "UxOP-UCOP" },
];

export const COMMON_CORE_SCHEMES: ReadonlyArray<CommonCoreSchemeDefinition> = [
  {
    value: "4Y",
    label: "Students Admitted Before 2022",
    categories: [
      { value: "ssc-humanities", label: "SSC-H", attributeValue: "09" },
      { value: "ssc-social-analysis", label: "SSC-SA", attributeValue: "10" },
      {
        value: "ssc-science-technology",
        label: "SSC-S&T",
        attributeValue: "11",
      },
      { value: "humanities", label: "H", attributeValue: "12" },
      { value: "social-analysis", label: "SA", attributeValue: "13" },
      { value: "science-technology", label: "S&T", attributeValue: "14" },
      {
        value: "quantitative-reasoning",
        label: "QR",
        attributeValue: "15",
      },
      { value: "arts", label: "Arts", attributeValue: "16" },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "17",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "18",
      },
      { value: "health", label: "HLTH", attributeValue: "19" },
    ],
  },
  {
    value: "CC22",
    label: "Students Admitted in 2022–2024",
    categories: [
      {
        value: "critical-thinking-data-literacy",
        label: "CTDL",
        attributeValue: "20",
      },
      {
        value: "healthy-lifestyle-mindfulness-well-being",
        label: "HMW",
        attributeValue: "21",
      },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "22",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "23",
      },
      { value: "arts", label: "A", attributeValue: "24" },
      { value: "humanities", label: "H", attributeValue: "25" },
      { value: "science", label: "S", attributeValue: "26" },
      { value: "technology", label: "T", attributeValue: "27" },
      { value: "social-analysis", label: "SA", attributeValue: "28" },
      ...opportunities.map((category, index) => ({
        ...category,
        attributeValue: String(29 + index),
      })),
    ],
  },
  {
    value: "CC25",
    label: "Students Admitted in 2025",
    categories: [
      {
        value: "critical-thinking-data-literacy",
        label: "CTDL",
        attributeValue: "33",
      },
      {
        value: "healthy-lifestyle-mindfulness-well-being",
        label: "HMW",
        attributeValue: "34",
      },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "35",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "36",
      },
      { value: "arts", label: "A", attributeValue: "37" },
      { value: "humanities", label: "H", attributeValue: "38" },
      { value: "science", label: "S", attributeValue: "39" },
      { value: "technology", label: "T", attributeValue: "40" },
      { value: "social-analysis", label: "SA", attributeValue: "41" },
      { value: "sustainability", label: "SUS", attributeValue: "42" },
      ...opportunities.map((category, index) => ({
        ...category,
        attributeValue: String(43 + index),
      })),
    ],
  },
  {
    value: "CC26",
    label: "Students Admitted From 2026",
    categories: [
      { value: "haic", label: "HAIC", attributeValue: "47" },
      {
        value: "healthy-lifestyle-mindfulness-well-being",
        label: "HMW",
        attributeValue: "48",
      },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "49",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "50",
      },
      { value: "arts", label: "A", attributeValue: "51" },
      { value: "humanities", label: "H", attributeValue: "52" },
      { value: "science", label: "S", attributeValue: "53" },
      { value: "technology", label: "T", attributeValue: "54" },
      { value: "social-analysis", label: "SA", attributeValue: "55" },
      { value: "sustainability", label: "SUS", attributeValue: "56" },
      ...opportunities.map((category, index) => ({
        ...category,
        attributeValue: String(57 + index),
      })),
    ],
  },
];

export type InstructorIdentity = {
  uuid: string;
  canonicalName: string;
  itsc?: string;
  aliases: Array<{
    name: string;
    source: "schedule" | "review" | "sfq" | "ranking-generation";
    sourceCommit: string;
    sourceFile?: "instructor-ratings.parquet";
  }>;
};

export type InstructorAssociationCorrectionRecord =
  | (InstructorAssociationCorrection & {
      correctionType: "split";
      status: "needs-resolution";
    })
  | (InstructorAssociationCorrection & {
      correctionType: "calibration";
      status: "resolved";
    });

export type InstructorIdentityEvent = InstructorIdentityHistoryEvent;

export type RankingsQuery = {
  entity: "course" | "instructor";
  termCode?: string;
  preset?: RankingPreset;
  weights?: RankingWeights;
  activity?: "current" | "all";
  search?: string;
  coursePrefix?: string;
  commonCoreScheme?: CommonCoreScheme;
  commonCore?: CommonCoreCategory[];
  course?: string;
  limit?: number;
  cursor?: string;
};

type RankFields = {
  score: number;
  rank?: number;
  rankPopulation: number;
  percentile?: number;
  allTimeRank: number;
  allTimePopulation: number;
  allTimePercentile: number;
  ustSpaceSamples: number;
  sfqSamples: number;
};

export type InstructorRanking = RankFields & {
  entity: "instructor";
  uuid: string;
  canonicalName: string;
  itsc?: string;
};

export type CourseRanking = RankFields & {
  entity: "course";
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  title?: string;
  commonCore: CommonCoreCategory[];
};

export type ScoreDistribution = {
  bins: number[];
  count: number;
  maximum: number;
  minimum: number;
};

export type RankingsPage<
  Entity extends "course" | "instructor" = "course" | "instructor",
> = {
  generation: string;
  population: {
    entity: Entity;
    termCode: string;
    activity: "current" | "all";
    size: number;
    filteredSize: number;
  };
  configuration: {
    preset: RankingPreset | "custom";
    weights: RankingWeights;
  };
  terms: Array<{ termCode: string; termName: string }>;
  results: [Entity] extends ["course"]
    ? CourseRanking[]
    : [Entity] extends ["instructor"]
      ? InstructorRanking[]
      : Array<CourseRanking | InstructorRanking>;
  nextCursor?: string;
  unrankedMatchCount: number;
};

type RankingTermEvidence = {
  termCode: string;
  criteria: Partial<
    Record<
      RankingCriterion,
      {
        bayesian: number;
        confidence: number;
        samples: number;
        cumulativeSamples: number;
      }
    >
  >;
};

export type InstructorIdentityLookup = {
  generation: string;
  instructor: InstructorIdentity;
  family: InstructorIdentity[];
  familyUuids: string[];
  route: { canonicalKey: string; redirect: boolean };
  identityHistory: {
    identifiers: InstructorIdentifierHistory[];
    events: InstructorIdentityEvent[];
    associationCorrections: InstructorAssociationCorrectionRecord[];
  };
};

export type InstructorHistoricalEvidence = {
  instructor: InstructorIdentity;
  terms: RankingTermEvidence[];
  courses: Array<{ termCode: string; courseCode: string }>;
};

export type Rankings = InstructorIdentityLookup & {
  population: RankingsPage["population"];
  configuration: RankingsPage["configuration"];
  scoreDistribution: ScoreDistribution;
  ranking?: InstructorRanking;
  terms: RankingTermEvidence[];
  courses: Array<{ termCode: string; courseCode: string }>;
  historicalEvidence: InstructorHistoricalEvidence[];
};

export type CourseRankings = {
  generation: string;
  population: RankingsPage<"course">["population"];
  configuration: RankingsPage<"course">["configuration"];
  scoreDistribution: ScoreDistribution;
  course: Pick<
    CourseRanking,
    "coursePrefix" | "courseNumber" | "courseCode" | "title" | "commonCore"
  >;
  ranking?: CourseRanking;
  terms: RankingTermEvidence[];
  instructors: Array<{
    termCode: string;
    instructor: InstructorIdentity;
  }>;
};
