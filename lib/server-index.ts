import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type {
  PublicReview,
  ReviewAssociations,
} from "@/lib/contributions/reviews";
import type { SignalTarget } from "@/lib/contributions/signals";
import {
  buildInstructorIdentityHistory,
  INSTRUCTOR_UUID_PATTERN,
  type InstructorIdentityHistory,
  ITSC_PATTERN,
  normalizeInstructorKey,
} from "@/lib/instructor-identity";
import type {
  InstructorAssociationCorrectionRecord,
  InstructorIdentity,
  InstructorIdentityLookup,
} from "@/lib/rankings/server";
import {
  DELIVERY_CDN_BASE_URL,
  DELIVERY_SCHEMA_VERSION,
  type DeliveryManifest,
  SERVER_INDEX_FILENAME,
  type ServerIndex,
} from "@/lib/server-index-contract";

const GENERATION_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const TERM_CODE_PATTERN = /^[0-9]{4}$/;
const COURSE_CODE_PATTERN = /^[A-Z]{2,8} [A-Z0-9]{2,6}(?:-[A-Z0-9]{2,6})?$/;
const SECTION_PATTERN = /^[A-Z][A-Z0-9-]{0,15}$/;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_POINTER_BYTES = 1024 * 1024;
const DEFAULT_LATEST_URL = `${DELIVERY_CDN_BASE_URL}/latest.json`;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ServerIndexActivation = {
  generation: string;
  indexUrl: string;
  bytes: number;
  sha256: string;
};

export type ServerIndexDependencies = {
  request: Fetch;
  latestUrl: string;
  allowIndexUrl(url: URL): boolean;
};

export type ActiveServerIndex = {
  readonly generation: string;
  canonicalDetailPaths(): string[];
  validateReviewAssociations(
    associations: ReviewAssociations,
  ): ReviewAssociations | undefined;
  reviewInstructorAssociationStatus(
    review: PublicReview,
  ): "resolved" | "historical" | "needs-resolution" | undefined;
  resolveSignalTarget(target: SignalTarget): SignalTarget | undefined;
  instructorIdentity(key: string): InstructorIdentityLookup | undefined;
  instructorNamesForUuids(uuids: string[]): Map<string, string>;
};

export class InvalidServerIndexRequestError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidServerIndexRequestError";
  }
}

export class ServerIndexUnavailableError extends Error {
  constructor() {
    super("Server Index is unavailable.");
    this.name = "ServerIndexUnavailableError";
  }
}

export class ServerIndexActivationError extends Error {
  constructor(
    public readonly failureClass: "upstream" | "integrity",
    options?: ErrorOptions,
  ) {
    super(
      "Server Index activation failed; previous generation remains active.",
      options,
    );
    this.name = "ServerIndexActivationError";
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Invalid ${name}`);
  return value.trim();
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${name}`);
  return Number(value);
}

function addUnique(set: Set<string>, value: string, name: string) {
  if (set.has(value)) throw new Error(`Duplicate ${name}`);
  set.add(value);
}

function courseCode(prefix: string, number: string) {
  return `${prefix} ${number}`;
}

function relationKey(uuid: string, termCode: string, code: string) {
  return `${uuid}\0${termCode}\0${code}`;
}

function classKey(
  termCode: string,
  code: string,
  section: string,
  classNumber: number,
) {
  return `${termCode}\0${code}\0${section}\0${classNumber}`;
}

async function responseBytes(response: Response, limit: number) {
  if (!response.ok || !response.body)
    throw new ServerIndexActivationError("upstream");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new ServerIndexActivationError("integrity");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new ServerIndexActivationError("integrity");
    }
    chunks.push(value);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    bytes,
  );
}

async function fetchJson(
  dependencies: ServerIndexDependencies,
  url: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await dependencies.request(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new ServerIndexActivationError("upstream", { cause });
  }
  const bytes = await responseBytes(response, MAX_POINTER_BYTES);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (cause) {
    throw new ServerIndexActivationError("integrity", { cause });
  }
}

function parseActivation(value: ServerIndexActivation): ServerIndexActivation {
  if (!GENERATION_PATTERN.test(value?.generation ?? ""))
    throw new InvalidServerIndexRequestError("Invalid generation");
  if (
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0 ||
    value.bytes > MAX_INDEX_BYTES
  )
    throw new InvalidServerIndexRequestError("Invalid Server Index size");
  if (!SHA256_PATTERN.test(value.sha256 ?? ""))
    throw new InvalidServerIndexRequestError("Invalid Server Index hash");
  let indexUrl: URL;
  try {
    indexUrl = new URL(value.indexUrl);
  } catch {
    throw new InvalidServerIndexRequestError("Invalid Server Index URL");
  }
  return { ...value, indexUrl: indexUrl.href };
}

function createActiveServerIndex(value: unknown, generation: string) {
  const source = object(value, "Server Index") as unknown as ServerIndex;
  if (
    source.schemaVersion !== DELIVERY_SCHEMA_VERSION ||
    source.generation !== generation
  )
    throw new Error("Server Index generation mismatch");

  const instructorRows = array(
    source.instructors,
    "Instructors",
  ) as ServerIndex["instructors"];
  const aliasRows = array(
    source.instructorAliases,
    "Instructor Aliases",
  ) as ServerIndex["instructorAliases"];
  const eventRows = array(
    source.instructorIdentityEvents,
    "Instructor Identity History",
  ) as ServerIndex["instructorIdentityEvents"];
  const correctionRows = array(
    source.associationCorrections,
    "Instructor Association Corrections",
  ) as ServerIndex["associationCorrections"];
  const redirectRows = array(
    source.instructorRedirects,
    "Instructor redirects",
  ) as ServerIndex["instructorRedirects"];

  const instructorUuids = new Set<string>();
  const itscs = new Set<string>();
  const identitiesByUuid = new Map<string, InstructorIdentity>();
  for (const row of instructorRows) {
    const uuid = string(row?.uuid, "Instructor UUID").toLowerCase();
    if (!INSTRUCTOR_UUID_PATTERN.test(uuid))
      throw new Error("Invalid Instructor UUID");
    addUnique(instructorUuids, uuid, "Instructor UUID");
    const canonicalName = string(
      row.canonicalName,
      "Canonical Instructor Name",
    );
    const itsc =
      row.itsc === undefined
        ? undefined
        : string(row.itsc, "ITSC").toLowerCase();
    if (itsc !== undefined) {
      if (!ITSC_PATTERN.test(itsc)) throw new Error("Invalid ITSC");
      addUnique(itscs, itsc, "ITSC");
    }
    identitiesByUuid.set(uuid, {
      uuid,
      canonicalName,
      ...(itsc ? { itsc } : {}),
      aliases: [],
    });
  }

  const aliasSourceCommitsByUuid = new Map<string, string[]>();
  const aliasKeys = new Set<string>();
  for (const row of aliasRows) {
    const uuid = string(row?.uuid, "Instructor Alias UUID").toLowerCase();
    const identity = identitiesByUuid.get(uuid);
    if (!identity) throw new Error("Unknown Instructor Alias UUID");
    const name = string(row.name, "Instructor Alias");
    const source = string(row.source, "Instructor Alias source");
    if (!SOURCE_COMMIT_PATTERN.test(row.sourceCommit))
      throw new Error("Invalid Instructor Alias source commit");
    const sourceFile =
      row.sourceFile === undefined
        ? undefined
        : string(row.sourceFile, "Instructor Alias source file");
    addUnique(
      aliasKeys,
      `${uuid}\0${name.toLocaleLowerCase()}`,
      "Instructor Alias",
    );
    identity.aliases.push({
      name,
      source: source as InstructorIdentity["aliases"][number]["source"],
      sourceCommit: row.sourceCommit,
      ...(sourceFile
        ? {
            sourceFile:
              sourceFile as InstructorIdentity["aliases"][number]["sourceFile"],
          }
        : {}),
    });
    const commits = aliasSourceCommitsByUuid.get(uuid) ?? [];
    commits.push(row.sourceCommit);
    aliasSourceCommitsByUuid.set(uuid, commits);
  }

  const history = buildInstructorIdentityHistory({
    sourceCommit: aliasRows[0]?.sourceCommit ?? "0".repeat(40),
    identities: instructorRows.map((row) => ({
      uuid: row.uuid,
      itsc: row.itsc,
      aliasSourceCommits:
        aliasSourceCommitsByUuid.get(row.uuid.toLowerCase()) ?? [],
    })),
    events: eventRows,
    associationCorrections: correctionRows,
  });
  const actualRedirects = [...history.redirectByUuid.entries()]
    .map(([from, to]) => `${from}\0${to}`)
    .sort();
  const declaredRedirects = redirectRows
    .map(
      (row) =>
        `${string(row?.from, "redirect source").toLowerCase()}\0${string(row?.to, "redirect target").toLowerCase()}`,
    )
    .sort();
  if (JSON.stringify(actualRedirects) !== JSON.stringify(declaredRedirects))
    throw new Error("Instructor redirects do not match identity history");

  const courses = new Set<string>();
  for (const row of array(
    source.courses,
    "Courses",
  ) as ServerIndex["courses"]) {
    const code = courseCode(
      string(row?.prefix, "Course Prefix"),
      string(row?.number, "Course Number"),
    );
    if (!COURSE_CODE_PATTERN.test(code)) throw new Error("Invalid Course Code");
    addUnique(courses, code, "Course");
  }

  const relations = new Set<string>();
  const relationsWithoutTerm = new Set<string>();
  const instructorTerms = new Set<string>();
  for (const row of array(
    source.relations,
    "relations",
  ) as ServerIndex["relations"]) {
    const uuid = string(row?.uuid, "relation Instructor UUID").toLowerCase();
    if (!instructorUuids.has(uuid))
      throw new Error("Unknown relation Instructor");
    integer(row.termNumber, "relation Term Number");
    const termCode = string(row.termCode, "relation Term Code");
    const code = string(row.courseCode, "relation Course Code");
    if (!TERM_CODE_PATTERN.test(termCode) || !courses.has(code))
      throw new Error("Invalid relation");
    const currentUuid = history.resolveUuid(uuid);
    relations.add(relationKey(currentUuid, termCode, code));
    relationsWithoutTerm.add(`${currentUuid}\0${code}`);
    instructorTerms.add(`${currentUuid}\0${termCode}`);
  }

  const offerings = new Set<string>();
  const offeringById = new Map<string, string>();
  for (const row of array(
    source.courseOfferings,
    "Course Offerings",
  ) as ServerIndex["courseOfferings"]) {
    integer(row.termNumber, "Course Offering Term Number");
    const termCode = string(row.termCode, "Course Offering Term Code");
    const code = string(row.courseCode, "Course Offering Course Code");
    const courseId = string(row.courseId, "Course Offering id");
    string(row.termName, "Course Offering Term Name");
    if (!TERM_CODE_PATTERN.test(termCode) || !courses.has(code))
      throw new Error("Invalid Course Offering");
    addUnique(offerings, `${termCode}\0${code}`, "Course Offering");
    const idKey = `${termCode}\0${courseId}`;
    if (offeringById.has(idKey))
      throw new Error("Duplicate Course Offering id");
    offeringById.set(idKey, code);
  }

  const classes = new Set<string>();
  const classById = new Map<string, string>();
  for (const row of array(
    source.classes,
    "Classes",
  ) as ServerIndex["classes"]) {
    integer(row.termNumber, "Class Term Number");
    const termCode = string(row.termCode, "Class Term Code");
    const code = string(row.courseCode, "Class Course Code");
    const courseId = string(row.courseId, "Class Course id");
    const section = string(row.section, "Class Section");
    const classNumber = integer(row.classNumber, "Class Number");
    if (
      !TERM_CODE_PATTERN.test(termCode) ||
      !SECTION_PATTERN.test(section) ||
      offeringById.get(`${termCode}\0${courseId}`) !== code
    )
      throw new Error("Invalid Class");
    const key = classKey(termCode, code, section, classNumber);
    addUnique(classes, key, "Class");
    classById.set(`${termCode}\0${courseId}\0${section}\0${classNumber}`, code);
  }

  const classInstructors = new Set<string>();
  for (const row of array(
    source.classInstructors,
    "Class-Instructor associations",
  ) as ServerIndex["classInstructors"]) {
    const termCode = string(row.termCode, "Class-Instructor Term Code");
    const courseId = string(row.courseId, "Class-Instructor Course id");
    const section = string(row.section, "Class-Instructor Section");
    const classNumber = integer(
      row.classNumber,
      "Class-Instructor Class Number",
    );
    const uuid = string(row.uuid, "Class-Instructor UUID").toLowerCase();
    string(row.sourceName, "Class-Instructor source name");
    const code = classById.get(
      `${termCode}\0${courseId}\0${section}\0${classNumber}`,
    );
    if (!code || !instructorUuids.has(uuid))
      throw new Error("Invalid Class-Instructor association");
    const currentUuid = history.resolveUuid(uuid);
    if (!relations.has(relationKey(currentUuid, termCode, code)))
      throw new Error("Class-Instructor association has no relation evidence");
    classInstructors.add(
      `${classKey(termCode, code, section, classNumber)}\0${currentUuid}`,
    );
  }

  const classSections = new Set(
    [...classes].map((key) => key.slice(0, key.lastIndexOf("\0"))),
  );
  const classInstructorSections = new Set(
    [...classInstructors].map((key) => {
      const withoutUuid = key.slice(0, key.lastIndexOf("\0"));
      return `${withoutUuid.slice(0, withoutUuid.lastIndexOf("\0"))}\0${key.slice(key.lastIndexOf("\0") + 1)}`;
    }),
  );

  const active: ActiveServerIndex & {
    identityHistory: InstructorIdentityHistory;
  } = {
    generation,
    identityHistory: history,
    canonicalDetailPaths() {
      return [
        ...[...courses].map((code) => {
          const separator = code.indexOf(" ");
          return `/courses/${code.slice(0, separator)}/${code.slice(separator + 1)}`;
        }),
        ...[...identitiesByUuid.values()]
          .filter(
            (identity) => history.resolveUuid(identity.uuid) === identity.uuid,
          )
          .map((identity) => `/instructors/${identity.itsc ?? identity.uuid}`),
      ].sort();
    },
    validateReviewAssociations(associations) {
      const code = associations.course
        ? courseCode(
            associations.course.coursePrefix,
            associations.course.courseNumber,
          )
        : undefined;
      if (code && !courses.has(code)) return undefined;
      const originalUuid = associations.instructorUuid?.toLowerCase();
      if (originalUuid && !instructorUuids.has(originalUuid)) return undefined;
      const uuid = originalUuid ? history.resolveUuid(originalUuid) : undefined;
      if (
        uuid &&
        associations.termCode &&
        !code &&
        !instructorTerms.has(`${uuid}\0${associations.termCode}`)
      )
        return undefined;
      if (
        uuid &&
        code &&
        !(associations.termCode
          ? relations.has(relationKey(uuid, associations.termCode, code))
          : relationsWithoutTerm.has(`${uuid}\0${code}`))
      )
        return undefined;
      if (
        code &&
        associations.termCode &&
        !offerings.has(`${associations.termCode}\0${code}`)
      )
        return undefined;
      if (code && associations.termCode && associations.section) {
        const sectionKey = `${associations.termCode}\0${code}\0${associations.section}`;
        if (!classSections.has(sectionKey)) return undefined;
        if (uuid && !classInstructorSections.has(`${sectionKey}\0${uuid}`))
          return undefined;
      }
      return {
        ...associations,
        ...(uuid ? { instructorUuid: uuid } : {}),
      };
    },
    reviewInstructorAssociationStatus(review) {
      if (!review.instructorUuid) return undefined;
      const originalUuid = review.instructorUuid.toLowerCase();
      if (!instructorUuids.has(originalUuid)) return "needs-resolution";
      const uuid = history.resolveUuid(originalUuid);
      const code = review.course
        ? courseCode(review.course.coursePrefix, review.course.courseNumber)
        : undefined;
      if (
        history
          .correctionsForUuids(new Set([originalUuid, uuid]))
          .some(
            (correction) =>
              correction.correctionType === "split" &&
              correction.targetUuid !== uuid &&
              (!code || correction.courseCode === code) &&
              (!review.termCode ||
                !correction.termCode ||
                correction.termCode === review.termCode),
          )
      )
        return "needs-resolution";
      if (uuid !== originalUuid) return "historical";
      return review.instructorAssociationStatus;
    },
    resolveSignalTarget(target) {
      if (target.type === "course")
        return courses.has(courseCode(target.coursePrefix, target.courseNumber))
          ? target
          : undefined;
      if (target.type === "instructor") {
        const originalUuid = target.instructorUuid.toLowerCase();
        return instructorUuids.has(originalUuid)
          ? {
              type: "instructor",
              instructorUuid: history.resolveUuid(originalUuid),
            }
          : undefined;
      }
      return undefined;
    },
    instructorIdentity(key) {
      const normalizedKey = normalizeInstructorKey(key);
      const requestedUuid = normalizedKey
        ? identitiesByUuid.has(normalizedKey)
          ? normalizedKey
          : history.uuidByItsc.get(normalizedKey)
        : undefined;
      if (!requestedUuid) return undefined;
      const uuid = history.resolveUuid(requestedUuid);
      const instructor = identitiesByUuid.get(uuid);
      if (!instructor) return undefined;
      const family = [...identitiesByUuid.values()].filter(
        (candidate) => history.resolveUuid(candidate.uuid) === uuid,
      );
      const familyUuids = family.map((candidate) => candidate.uuid);
      const familySet = new Set(familyUuids);
      const canonicalKey = instructor.itsc ?? instructor.uuid;
      return {
        generation,
        instructor,
        family,
        familyUuids,
        route: {
          canonicalKey,
          redirect: normalizedKey !== canonicalKey,
        },
        identityHistory: {
          identifiers: familyUuids.flatMap(
            (familyUuid) => history.identifiersByUuid.get(familyUuid) ?? [],
          ),
          events: history.events.filter((event) => {
            if (event.type === "itsc-added") return familySet.has(event.uuid);
            if (event.type === "merge")
              return (
                familySet.has(event.retiredUuid) ||
                familySet.has(event.survivorUuid)
              );
            return (
              familySet.has(event.sourceUuid) || familySet.has(event.newUuid)
            );
          }),
          associationCorrections: history.correctionsForUuids(familySet).map(
            (correction): InstructorAssociationCorrectionRecord =>
              correction.correctionType === "split"
                ? {
                    ...correction,
                    correctionType: "split",
                    status: "needs-resolution",
                  }
                : {
                    ...correction,
                    correctionType: "calibration",
                    status: "resolved",
                  },
          ),
        },
      };
    },
    instructorNamesForUuids(uuids) {
      const names = new Map<string, string>();
      for (const requestedUuid of new Set(
        uuids.map((uuid) => uuid.toLowerCase()),
      )) {
        const identity = identitiesByUuid.get(requestedUuid);
        if (!identity) continue;
        const instructor = identitiesByUuid.get(
          history.resolveUuid(identity.uuid),
        );
        if (instructor) names.set(requestedUuid, instructor.canonicalName);
      }
      return names;
    },
  };
  return active;
}

async function loadCandidate(
  input: ServerIndexActivation,
  dependencies: ServerIndexDependencies,
) {
  const url = new URL(input.indexUrl);
  if (!dependencies.allowIndexUrl(url))
    throw new InvalidServerIndexRequestError("Server Index URL is not allowed");
  let response: Response;
  try {
    response = await dependencies.request(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw new ServerIndexActivationError("upstream", { cause });
  }
  const compressed = await responseBytes(response, MAX_INDEX_BYTES);
  if (
    compressed.byteLength !== input.bytes ||
    createHash("sha256").update(compressed).digest("hex") !== input.sha256
  )
    throw new ServerIndexActivationError("integrity");
  try {
    const json = gunzipSync(compressed, {
      maxOutputLength: MAX_INDEX_JSON_BYTES,
    }).toString("utf8");
    return createActiveServerIndex(
      JSON.parse(json) as unknown,
      input.generation,
    );
  } catch (cause) {
    if (cause instanceof ServerIndexActivationError) throw cause;
    throw new ServerIndexActivationError("integrity", { cause });
  }
}

type ServerIndexRuntimeState = {
  activeIndex?: ActiveServerIndex;
  activationLock: Promise<void>;
  pendingActivation?: Promise<{
    status: "activated" | "current";
    generation: string;
  }>;
  initialization?: Promise<ActiveServerIndex>;
};

const serverIndexGlobal = globalThis as typeof globalThis & {
  __ustRankingsServerIndex?: ServerIndexRuntimeState;
};
serverIndexGlobal.__ustRankingsServerIndex ??= {
  activationLock: Promise.resolve(),
};
const serverIndexState = serverIndexGlobal.__ustRankingsServerIndex;

async function withActivationLock<T>(operation: () => Promise<T>) {
  const previous = serverIndexState.activationLock;
  let release = () => {};
  serverIndexState.activationLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function productionServerIndexDependencies(): ServerIndexDependencies {
  const developmentBase =
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.NEXT_PUBLIC_DELIVERY_BASE_URL?.replace(/\/$/, "");
  const developmentOrigin = developmentBase
    ? new URL(developmentBase).origin
    : undefined;
  return {
    request: fetch,
    latestUrl: developmentBase
      ? `${developmentBase}/latest.json`
      : DEFAULT_LATEST_URL,
    allowIndexUrl: developmentOrigin
      ? (url) =>
          url.origin === developmentOrigin &&
          new RegExp(
            `^/[0-9a-f]{64}/${SERVER_INDEX_FILENAME.replaceAll(".", "\\.")}$`,
          ).test(url.pathname)
      : isImmutableServerIndexUrl,
  };
}

export function isImmutableServerIndexUrl(url: URL) {
  return (
    url.protocol === "https:" &&
    url.origin === DELIVERY_CDN_BASE_URL &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    new RegExp(
      `^/[0-9a-f]{64}/${SERVER_INDEX_FILENAME.replaceAll(".", "\\.")}$`,
    ).test(url.pathname)
  );
}

async function activateParsed(
  input: ServerIndexActivation,
  dependencies: ServerIndexDependencies,
  replace: boolean,
) {
  return withActivationLock(async () => {
    if (serverIndexState.activeIndex?.generation === input.generation)
      return { status: "current" as const, generation: input.generation };
    if (!replace && serverIndexState.activeIndex)
      return {
        status: "current" as const,
        generation: serverIndexState.activeIndex.generation,
      };
    const candidate = await loadCandidate(input, dependencies);
    serverIndexState.activeIndex = candidate;
    return { status: "activated" as const, generation: input.generation };
  });
}

export function activateServerIndex(
  request: ServerIndexActivation,
  dependencies = productionServerIndexDependencies(),
) {
  const input = parseActivation(request);
  const activation = activateParsed(input, dependencies, true);
  serverIndexState.pendingActivation = activation;
  void activation.then(
    () => {
      if (serverIndexState.pendingActivation === activation)
        serverIndexState.pendingActivation = undefined;
    },
    () => {
      if (serverIndexState.pendingActivation === activation)
        serverIndexState.pendingActivation = undefined;
    },
  );
  return activation;
}

async function recoverServerIndex(dependencies: ServerIndexDependencies) {
  const latest = object(
    await fetchJson(dependencies, dependencies.latestUrl),
    "latest pointer",
  );
  const generation = string(latest.generation, "latest generation");
  const manifestUrl = string(latest.manifest, "Delivery manifest URL");
  if (!GENERATION_PATTERN.test(generation))
    throw new ServerIndexActivationError("integrity");
  const expectedManifest = new URL(
    `${generation}/manifest.json`,
    dependencies.latestUrl,
  ).href;
  if (manifestUrl !== expectedManifest)
    throw new ServerIndexActivationError("integrity");
  const manifestValue = object(
    await fetchJson(dependencies, manifestUrl),
    "Delivery manifest",
  );
  if (
    manifestValue.schemaVersion !== DELIVERY_SCHEMA_VERSION ||
    manifestValue.generation !== generation
  )
    throw new ServerIndexActivationError("integrity");
  if (!("serverIndex" in manifestValue))
    throw new ServerIndexActivationError("integrity");
  const manifest = manifestValue as unknown as DeliveryManifest;
  if (
    manifest.serverIndex?.generation !== generation ||
    manifest.serverIndex.name !== SERVER_INDEX_FILENAME
  )
    throw new ServerIndexActivationError("integrity");
  const indexUrl = new URL(manifest.serverIndex.url, manifestUrl).href;
  await activateParsed(
    parseActivation({
      generation,
      indexUrl,
      bytes: manifest.serverIndex.bytes,
      sha256: manifest.serverIndex.sha256,
    }),
    dependencies,
    false,
  );
  if (!serverIndexState.activeIndex)
    throw new ServerIndexActivationError("integrity");
  return serverIndexState.activeIndex;
}

export function initializeServerIndex(
  dependencies = productionServerIndexDependencies(),
) {
  if (serverIndexState.activeIndex)
    return Promise.resolve(serverIndexState.activeIndex);
  serverIndexState.initialization ??= recoverServerIndex(dependencies).finally(
    () => {
      serverIndexState.initialization = undefined;
    },
  );
  return serverIndexState.initialization;
}

export function activeServerIndexGeneration() {
  return serverIndexState.activeIndex?.generation;
}

export async function currentServerIndex() {
  if (serverIndexState.activeIndex) return serverIndexState.activeIndex;
  try {
    if (serverIndexState.pendingActivation)
      await serverIndexState.pendingActivation;
    else if (serverIndexState.initialization)
      await serverIndexState.initialization;
    else if (process.env.NODE_ENV !== "test") await initializeServerIndex();
  } catch {
    // Writes fail closed below while static Community reads remain independent.
  }
  if (serverIndexState.activeIndex) return serverIndexState.activeIndex;
  throw new ServerIndexUnavailableError();
}

export async function instructorNamesForUuids(uuids: string[]) {
  if (uuids.length === 0) return new Map<string, string>();
  try {
    return (await currentServerIndex()).instructorNamesForUuids(uuids);
  } catch (error) {
    if (error instanceof ServerIndexUnavailableError)
      return new Map<string, string>();
    throw error;
  }
}

export function installServerIndexForTests(index: ServerIndex) {
  serverIndexState.activeIndex = createActiveServerIndex(
    index,
    index.generation,
  );
  return serverIndexState.activeIndex;
}

export function resetServerIndexForTests() {
  serverIndexState.activeIndex = undefined;
  serverIndexState.pendingActivation = undefined;
  serverIndexState.initialization = undefined;
  serverIndexState.activationLock = Promise.resolve();
}
