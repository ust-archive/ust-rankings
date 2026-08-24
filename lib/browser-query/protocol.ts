import type {
  CourseRankings,
  Rankings,
  RankingsPage,
  RankingsQuery,
} from "@/lib/rankings/server";

export type CatalogCourse = {
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  title: string;
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
