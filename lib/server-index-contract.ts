import type {
  InstructorAssociationCorrection,
  InstructorIdentityHistoryEvent,
} from "./instructor-identity.ts";

export const DELIVERY_SCHEMA_VERSION = 1;
export const DELIVERY_CDN_BASE_URL =
  "https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com";
export const SERVER_INDEX_FILENAME = "server-index.json.gz";

export const DELIVERY_ARTIFACTS = [
  "course-ratings.parquet",
  "courses.parquet",
  "instructor-aliases.parquet",
  "instructor-identity-events.parquet",
  "instructor-ratings.parquet",
  "instructor-split-associations.parquet",
  "instructors.parquet",
  "relation.parquet",
  "schedule-classes.parquet",
  "schedule-courses.parquet",
] as const;

export type DeliveryArtifactName = (typeof DELIVERY_ARTIFACTS)[number];

export type DeliveryArtifactDeclaration = {
  url: string;
  bytes: number;
  sha256: string;
};

export type ServerIndex = {
  schemaVersion: number;
  generation: string;
  courses: Array<{ prefix: string; number: string }>;
  instructors: Array<{
    uuid: string;
    canonicalName: string;
    itsc?: string;
  }>;
  instructorAliases: Array<{
    uuid: string;
    name: string;
    source: string;
    sourceCommit: string;
    sourceFile?: string;
  }>;
  instructorIdentityEvents: InstructorIdentityHistoryEvent[];
  instructorRedirects: Array<{ from: string; to: string }>;
  associationCorrections: InstructorAssociationCorrection[];
  relations: Array<{
    uuid: string;
    termNumber: number;
    termCode: string;
    courseCode: string;
  }>;
  courseOfferings: Array<{
    termNumber: number;
    termCode: string;
    termName: string;
    courseId: string;
    courseCode: string;
  }>;
  classes: Array<{
    termNumber: number;
    termCode: string;
    courseId: string;
    section: string;
    classNumber: number;
    courseCode: string;
  }>;
  classInstructors: Array<{
    termCode: string;
    courseId: string;
    section: string;
    classNumber: number;
    uuid: string;
    sourceName: string;
  }>;
};

export type DeliveryManifest = {
  schemaVersion: number;
  generation: string;
  sources: {
    rankings: string;
    schedule: string;
  };
  artifacts: Record<DeliveryArtifactName, DeliveryArtifactDeclaration>;
  serverIndex: {
    name: typeof SERVER_INDEX_FILENAME;
    url: string;
    generation: string;
    bytes: number;
    sha256: string;
  };
};
