import type {
  CourseRankings,
  Rankings,
  RankingsPage,
  RankingsQuery,
} from "@/lib/rankings/server";
import type {
  ScheduleDetails,
  ScheduleEntity,
  SchedulePage,
} from "@/lib/schedule/server";
import type { WaitlistEvidenceManifest } from "@/lib/server-index-contract";

export type CatalogCourse = {
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  title: string;
};

export type WaitlistSeason = "Fall" | "Spring";
export type WaitlistTerm = {
  termNumber: number;
  termCode: string;
  termName: string;
  season: WaitlistSeason;
  enrollmentStart: string;
  addDropEnd: string;
  source: string;
};
export type WaitlistUnsupportedReason =
  | "consent-required"
  | "inactive"
  | "non-waitlisted"
  | "unsupported-term"
  | "irregular-term"
  | "missing-date"
  | "missing-activation"
  | "malformed"
  | "class-not-found"
  | "duplicate-class"
  | "duplicate-component"
  | "no-history"
  | "stale-position";
export type WaitlistReservation = {
  name: string;
  quota: number;
  enrollment: number;
};
export type WaitlistClass = {
  section: string;
  classNumber: number;
  classType: "LEC" | "TUT" | "LAB" | "IND";
  capacity: number;
  enrollment: number;
  waitlist: number;
  consent: boolean;
  open: boolean;
  observedAt?: string;
  schedules: Record<string, unknown>[];
  reservations: WaitlistReservation[];
  eligible: boolean;
  unsupportedReason?: WaitlistUnsupportedReason;
};
export type WaitlistCourseOffering = {
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  title: string;
  classes: WaitlistClass[];
};
export type WaitlistSearchResult = {
  generation: string;
  term: WaitlistTerm;
  search?: string;
  total: number;
  results: WaitlistCourseOffering[];
};
export type WaitlistPlanInput = {
  termCode: string;
  coursePrefix: string;
  courseNumber: string;
  classes: Array<{ section: string; position: number }>;
};
export type WaitlistSmoothing = {
  successes: number;
  priorRate: number;
  priorWeight: number;
  exactSamples: number;
  numerator: number;
  denominator: number;
  estimate: number;
};
export type WaitlistComponentResult = {
  type: WaitlistClass["classType"];
  section: string;
  classNumber: number;
  position: number;
  activationAt?: string;
  observedAt?: string;
  activationHours?: number;
  current: Pick<
    WaitlistClass,
    "capacity" | "enrollment" | "waitlist" | "consent" | "open" | "reservations"
  >;
  historical: {
    samples: number;
    successes: number;
    averageNetReduction?: number;
    averageGrossExits?: number;
    minimumNetReduction?: number;
    maximumNetReduction?: number;
  };
  capacityScenarios: Array<{
    name: "current" | "venue" | "historical-large";
    capacity?: number;
    status: "known" | "unknown";
  }>;
};
export type WaitlistPlanResult =
  | {
      status: "supported";
      generation: string;
      term: WaitlistTerm;
      course: string;
      model: WaitlistEvidenceManifest;
      headline: string;
      estimate: number;
      margin: number;
      range: { low: number; high: number };
      exactHistoryCount: number;
      broaderHistoryCount: number;
      prior: {
        rate: number;
        samples: number;
        weight: number;
        influence: number;
      };
      smoothing: WaitlistSmoothing;
      joint: { successes: number; samples: number };
      components: WaitlistComponentResult[];
      sourceObservationTime: string;
    }
  | {
      status: "unsupported";
      generation: string;
      term?: WaitlistTerm;
      course?: string;
      reason: WaitlistUnsupportedReason;
      message: string;
    };

export type CourseQueryOperations = {
  catalog: {
    input: { search?: string; limit?: number };
    output: CatalogCourse[];
  };
  courseRankings: {
    input: RankingsQuery & { entity: "course" };
    output: RankingsPage<"course">;
  };
  instructorRankings: {
    input: RankingsQuery & { entity: "instructor" };
    output: RankingsPage<"instructor">;
  };
  instructorDetails: {
    input: {
      key: string;
      termCode?: string;
      activity?: "current" | "all";
      preset?: "learning" | "grade";
      weights?: RankingsQuery["weights"];
    };
    output: Rankings;
  };
  schedulePage: {
    input: { termCode?: string; search?: string; limit?: number };
    output: SchedulePage;
  };
  scheduleDetails: {
    input: ScheduleEntity;
    output: ScheduleDetails;
  };
  courseDetails: {
    input: {
      coursePrefix: string;
      courseNumber: string;
      termCode?: string;
      activity?: "current" | "all";
      preset?: "learning" | "grade";
      weights?: RankingsQuery["weights"];
    };
    output: CourseRankings;
  };
  waitlistSearch: {
    input: { search?: string; limit?: number };
    output: WaitlistSearchResult;
  };
  waitlistPlan: {
    input: WaitlistPlanInput;
    output: WaitlistPlanResult;
  };
};

export type CourseQueryOperation = keyof CourseQueryOperations;

export type QueryRequest<
  Operation extends CourseQueryOperation = CourseQueryOperation,
> = {
  id: number;
  baseUrl: string;
  operation: Operation;
  input: CourseQueryOperations[Operation]["input"];
};

export type QueryResponse =
  | { id: number; ok: true; output: unknown }
  | {
      id: number;
      ok: false;
      error: {
        code: "invalid" | "stale" | "unavailable" | "unknown";
        message: string;
      };
    };
