import type {
  InstructorAssociationCorrection,
  InstructorIdentityHistoryEvent,
} from "./instructor-identity.ts";

export const DELIVERY_SCHEMA_VERSION = 1;
export const DELIVERY_CDN_BASE_URL =
  "https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com";
export const SERVER_INDEX_FILENAME = "server-index.json.gz";
export const WAITLIST_EVIDENCE_FILENAME = "waitlist-evidence.parquet";
export const WAITLIST_SOURCE_ARTIFACTS = [
  "canonical/class_records.parquet",
  "classes_legacy.parquet",
] as const;

export type WaitlistEvidenceManifest = {
  artifact: typeof WAITLIST_EVIDENCE_FILENAME;
  schemaVersion: number;
  modelVersion: string;
  sourceArtifact: (typeof WAITLIST_SOURCE_ARTIFACTS)[number];
  sourceRevision: string;
  sourceAvailable: boolean;
  selectedModel: "baseline";
  priorWeight: number;
  timing: {
    activation: "first-positive-wait";
    normalEnrollment: "official-registry";
    addDrop: "official-registry";
    sinceActivationBucketsHours: readonly number[];
    sinceEnrollmentBucketDays: number;
    untilAddDropBucketDays: number;
  };
  tuning: {
    positions: readonly number[];
    activationHours: readonly number[];
    priorWeights: readonly number[];
    holdout: "whole-term";
  };
  uncertainty: "estimated-bounded-margin-not-calibrated-interval";
  terms: ReadonlyArray<{
    termCode: string;
    season: "Fall" | "Spring";
    enrollmentStart: string;
    addDropEnd: string;
    source: string;
  }>;
};

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
  WAITLIST_EVIDENCE_FILENAME,
] as const;

export type DeliveryArtifactName = (typeof DELIVERY_ARTIFACTS)[number];

export type DeliveryArtifactDeclaration = {
  url: string;
  bytes: number;
  sha256: string;
};

export function deliveryGenerationIdentityInput(input: {
  sources: { rankings: string; schedule: string };
  artifacts: Record<DeliveryArtifactName, { sha256: string }>;
  serverIndexIdentitySha256: string;
}) {
  return JSON.stringify({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    sources: input.sources,
    artifacts: DELIVERY_ARTIFACTS.map((name) => [
      name,
      input.artifacts[name].sha256,
    ]),
    serverIndex: input.serverIndexIdentitySha256,
  });
}

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
  waitlistEvidence: WaitlistEvidenceManifest;
  serverIndex: {
    name: typeof SERVER_INDEX_FILENAME;
    url: string;
    generation: string;
    bytes: number;
    sha256: string;
    identitySha256: string;
  };
};
