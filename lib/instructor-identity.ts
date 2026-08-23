export const INSTRUCTOR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ITSC_PATTERN = /^[a-z][a-z0-9._-]{1,31}$/;

const COURSE_CODE_PATTERN = /^[A-Z]{2,8} [0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function normalizeInstructorKey(value: string) {
  const normalized = value.trim().toLowerCase();
  return INSTRUCTOR_UUID_PATTERN.test(normalized) ||
    ITSC_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

export function normalizeInstructorUuid(value: string) {
  const normalized = value.trim().toLowerCase();
  return INSTRUCTOR_UUID_PATTERN.test(normalized) ? normalized : undefined;
}

export type InstructorAssociationCorrection = {
  correctionType: "split" | "calibration";
  sourceCommit: string;
  sourceName: string;
  termCode?: string;
  courseCode: string;
  targetUuid: string;
};

export type InstructorIdentityHistoryEvent =
  | {
      type: "itsc-added";
      uuid: string;
      itsc: string;
      sourceCommit: string;
    }
  | {
      type: "merge";
      retiredUuid: string;
      survivorUuid: string;
      sourceCommit: string;
    }
  | {
      type: "split";
      sourceUuid: string;
      newUuid: string;
      sourceCommit: string;
    };

export type InstructorIdentifierHistory = {
  type: "itsc";
  value: string;
  status: "current" | "retired";
  sourceCommit: string;
};

type IdentityHistoryInput = {
  sourceCommit: string;
  identities: ReadonlyArray<{
    uuid: string;
    itsc?: string | null;
    aliasSourceCommits: ReadonlyArray<string>;
  }>;
  events: ReadonlyArray<InstructorIdentityHistoryEvent>;
  associationCorrections: ReadonlyArray<InstructorAssociationCorrection>;
};

export type InstructorAssociationQuery = {
  sourceName: string;
  sourceAliases?: ReadonlyArray<string>;
  termCode: string;
  courseCode: string;
  uuid?: string;
};

export type InstructorAssociationResolution =
  | {
      status: "resolved";
      uuid: string;
      correction?: InstructorAssociationCorrection;
    }
  | {
      status: "needs-resolution";
      correction: InstructorAssociationCorrection;
    }
  | { status: "unresolved" };

export type InstructorIdentityHistory = {
  events: ReadonlyArray<InstructorIdentityHistoryEvent>;
  redirectByUuid: ReadonlyMap<string, string>;
  identifiersByUuid: ReadonlyMap<string, InstructorIdentifierHistory[]>;
  itscByUuid: ReadonlyMap<string, string>;
  uuidByItsc: ReadonlyMap<string, string>;
  associationCorrections: ReadonlyArray<InstructorAssociationCorrection>;
  resolveUuid(uuid: string): string;
  matchAssociation(
    query: Omit<InstructorAssociationQuery, "uuid">,
  ): InstructorAssociationCorrection | undefined;
  resolveAssociation(
    query: InstructorAssociationQuery,
  ): InstructorAssociationResolution;
  correctionsForUuids(
    uuids: ReadonlySet<string>,
  ): InstructorAssociationCorrection[];
};

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function correctionSpecificity(correction: InstructorAssociationCorrection) {
  return correction.termCode === undefined ? 0 : 1;
}

function correctionKey(correction: InstructorAssociationCorrection) {
  return [
    normalizedName(correction.sourceName),
    correction.courseCode,
    correction.termCode ?? "",
    correction.correctionType,
    correction.targetUuid,
    correction.sourceCommit,
  ].join("\0");
}

function validateCommit(value: string) {
  return COMMIT_PATTERN.test(value);
}

export function buildInstructorIdentityHistory(
  input: IdentityHistoryInput,
): InstructorIdentityHistory {
  if (!input.sourceCommit.trim())
    throw new Error("Invalid Instructor identity history");
  const identities = new Map<
    string,
    { uuid: string; itsc?: string; aliasSourceCommits: ReadonlyArray<string> }
  >();
  for (const identity of input.identities) {
    const uuid = identity.uuid?.trim().toLowerCase();
    if (!uuid || !INSTRUCTOR_UUID_PATTERN.test(uuid) || identities.has(uuid))
      throw new Error("Invalid Instructor identity history");
    const itsc = identity.itsc?.trim().toLowerCase();
    if (itsc !== undefined && !ITSC_PATTERN.test(itsc))
      throw new Error("Invalid Instructor identity history");
    identities.set(uuid, {
      uuid,
      ...(itsc ? { itsc } : {}),
      aliasSourceCommits: identity.aliasSourceCommits,
    });
  }

  const redirects = new Map<string, string>();
  const identifiers = new Map<string, InstructorIdentifierHistory[]>();
  const claimedItscs = new Map<string, string>();
  for (const identity of identities.values()) {
    if (!identity.itsc) continue;
    if (claimedItscs.has(identity.itsc))
      throw new Error("ITSC history is not unique");
    claimedItscs.set(identity.itsc, identity.uuid);
    identifiers.set(identity.uuid, [
      {
        type: "itsc",
        value: identity.itsc,
        status: "current",
        sourceCommit: input.sourceCommit,
      },
    ]);
  }

  const eventKeys = new Set<string>();
  const splitTargets = new Set<string>();
  const addedItscs = new Set<string>();
  for (const event of input.events) {
    const sourceCommit = event.sourceCommit?.trim();
    if (
      !sourceCommit ||
      !validateCommit(sourceCommit) ||
      eventKeys.has(JSON.stringify(event))
    )
      throw new Error("Invalid Instructor identity event history");
    eventKeys.add(JSON.stringify(event));
    if (event.type === "itsc-added") {
      const uuid = event.uuid?.trim().toLowerCase();
      const itsc = event.itsc?.trim().toLowerCase();
      if (
        !uuid ||
        !identities.has(uuid) ||
        !itsc ||
        !ITSC_PATTERN.test(itsc) ||
        addedItscs.has(itsc) ||
        (claimedItscs.has(itsc) && claimedItscs.get(itsc) !== uuid)
      )
        throw new Error("Invalid ITSC addition");
      addedItscs.add(itsc);
      const history = identifiers.get(uuid) ?? [];
      for (const identifier of history) identifier.status = "retired";
      const existing = history.find((identifier) => identifier.value === itsc);
      if (existing) {
        existing.status = "current";
        existing.sourceCommit = sourceCommit;
      } else {
        history.push({
          type: "itsc",
          value: itsc,
          status: "current",
          sourceCommit,
        });
      }
      identifiers.set(uuid, history);
      claimedItscs.set(itsc, uuid);
      const identity = identities.get(uuid);
      if (identity) identity.itsc = itsc;
      continue;
    }
    if (event.type === "merge") {
      const retiredUuid = event.retiredUuid?.trim().toLowerCase();
      const survivorUuid = event.survivorUuid?.trim().toLowerCase();
      if (
        !retiredUuid ||
        !survivorUuid ||
        retiredUuid === survivorUuid ||
        !identities.has(retiredUuid) ||
        !identities.has(survivorUuid) ||
        redirects.has(retiredUuid)
      )
        throw new Error("Invalid Instructor merge");
      redirects.set(retiredUuid, survivorUuid);
      continue;
    }
    if (event.type === "split") {
      const sourceUuid = event.sourceUuid?.trim().toLowerCase();
      const newUuid = event.newUuid?.trim().toLowerCase();
      if (
        !sourceUuid ||
        !newUuid ||
        sourceUuid === newUuid ||
        !identities.has(sourceUuid) ||
        !identities.get(newUuid)?.aliasSourceCommits.includes(sourceCommit) ||
        splitTargets.has(newUuid)
      )
        throw new Error("Invalid Instructor split");
      splitTargets.add(newUuid);
      continue;
    }
    throw new Error("Unknown Instructor identity event");
  }

  const resolveUuid = (uuid: string) => {
    let current = uuid.trim().toLowerCase();
    const visited = new Set<string>();
    while (redirects.has(current)) {
      if (visited.has(current)) throw new Error("Cyclic Instructor merge");
      visited.add(current);
      current = redirects.get(current) as string;
    }
    return current;
  };
  for (const uuid of identities.keys()) resolveUuid(uuid);

  for (const [uuid, history] of identifiers) {
    const finalUuid = resolveUuid(uuid);
    const preferred = identities.get(finalUuid)?.itsc;
    for (const identifier of history)
      identifier.status =
        uuid === finalUuid && identifier.value === preferred
          ? "current"
          : "retired";
  }

  const correctionKeys = new Set<string>();
  const correctedSplitTargets = new Set<string>();
  const corrections: InstructorAssociationCorrection[] = [];
  for (const correction of input.associationCorrections) {
    const sourceName = correction.sourceName?.trim();
    const courseCode = correction.courseCode?.trim();
    const termCode = correction.termCode?.trim();
    const targetUuid = correction.targetUuid?.trim().toLowerCase();
    if (
      !sourceName ||
      !["split", "calibration"].includes(correction.correctionType) ||
      !validateCommit(correction.sourceCommit) ||
      !courseCode ||
      !COURSE_CODE_PATTERN.test(courseCode) ||
      (termCode !== undefined && !/^[0-9]{4}$/.test(termCode)) ||
      !targetUuid
    )
      throw new Error("Invalid Instructor association correction");
    if (!identities.has(targetUuid))
      throw new Error(`Unknown Instructor association target: ${targetUuid}`);
    if (correction.correctionType === "split") {
      if (!splitTargets.has(targetUuid))
        throw new Error("Invalid Instructor association correction");
      correctedSplitTargets.add(targetUuid);
    }
    const normalized = {
      ...correction,
      sourceCommit: correction.sourceCommit.trim(),
      sourceName,
      courseCode,
      ...(termCode ? { termCode } : {}),
      targetUuid: resolveUuid(targetUuid),
    } satisfies InstructorAssociationCorrection;
    const key = correctionKey(normalized);
    if (correctionKeys.has(key)) continue;
    correctionKeys.add(key);
    corrections.push(normalized);
  }
  if ([...splitTargets].some((uuid) => !correctedSplitTargets.has(uuid)))
    throw new Error("Invalid Instructor split");

  const grouped = new Map<string, InstructorAssociationCorrection[]>();
  for (const correction of corrections) {
    const key = [
      normalizedName(correction.sourceName),
      correction.courseCode,
      correction.termCode ?? "",
    ].join("\0");
    const group = grouped.get(key) ?? [];
    group.push(correction);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    if (new Set(group.map((correction) => correction.targetUuid)).size > 1)
      throw new Error("Conflicting Instructor association correction");
  }

  const matchAssociation = (
    query: Omit<InstructorAssociationQuery, "uuid">,
  ) => {
    const sourceNames = new Set(
      [query.sourceName, ...(query.sourceAliases ?? [])].map(normalizedName),
    );
    const matches = corrections.filter(
      (correction) =>
        sourceNames.has(normalizedName(correction.sourceName)) &&
        correction.courseCode === query.courseCode &&
        (correction.termCode === undefined ||
          correction.termCode === query.termCode),
    );
    if (matches.length === 0) return undefined;
    const specificity = Math.max(...matches.map(correctionSpecificity));
    const exact = matches.filter(
      (correction) => correctionSpecificity(correction) === specificity,
    );
    const targets = new Set(exact.map((correction) => correction.targetUuid));
    if (targets.size > 1)
      throw new Error("Conflicting Instructor association correction");
    return (
      exact.find((correction) => correction.correctionType === "calibration") ??
      exact[0]
    );
  };

  const resolveAssociation = (
    query: InstructorAssociationQuery,
  ): InstructorAssociationResolution => {
    const correction = matchAssociation(query);
    if (correction?.correctionType === "calibration")
      return { status: "resolved", uuid: correction.targetUuid, correction };
    if (correction?.correctionType === "split") {
      const uuid = query.uuid ? resolveUuid(query.uuid) : undefined;
      return uuid === correction.targetUuid
        ? { status: "resolved", uuid, correction }
        : { status: "needs-resolution", correction };
    }
    if (!query.uuid) return { status: "unresolved" };
    const uuid = query.uuid.trim().toLowerCase();
    return identities.has(uuid)
      ? { status: "resolved", uuid: resolveUuid(uuid) }
      : { status: "unresolved" };
  };

  const itscByUuid = new Map(
    [...identities.values()].flatMap((identity) =>
      identity.itsc ? [[identity.uuid, identity.itsc] as const] : [],
    ),
  );
  const uuidByItsc = new Map<string, string>();
  for (const [itsc, uuid] of claimedItscs)
    uuidByItsc.set(itsc, resolveUuid(uuid));

  const correctionsForUuids = (uuids: ReadonlySet<string>) => {
    const family = new Set([...uuids].map(resolveUuid));
    const splitTargetsForFamily = new Set(
      input.events.flatMap((event) =>
        event.type === "split" &&
        (family.has(resolveUuid(event.sourceUuid)) ||
          family.has(resolveUuid(event.newUuid)))
          ? [resolveUuid(event.newUuid)]
          : [],
      ),
    );
    return corrections.filter(
      (correction) =>
        family.has(resolveUuid(correction.targetUuid)) ||
        (correction.correctionType === "split" &&
          splitTargetsForFamily.has(resolveUuid(correction.targetUuid))),
    );
  };

  return {
    events: input.events,
    redirectByUuid: redirects,
    itscByUuid,
    uuidByItsc,
    identifiersByUuid: identifiers,
    associationCorrections: corrections,
    resolveUuid,
    matchAssociation,
    resolveAssociation,
    correctionsForUuids,
  };
}
