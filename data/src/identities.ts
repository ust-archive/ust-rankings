import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  buildInstructorIdentityHistory,
  type InstructorAssociationCorrection,
  type InstructorIdentityHistoryEvent,
} from "../../lib/instructor-identity.ts";

const IDENTITY_FILES = [
  "instructor-identities.parquet",
  "instructor-aliases.parquet",
  "instructor-identity-events.parquet",
  "instructor-split-affected-associations.parquet",
] as const;

type AliasRow = {
  uuid: string;
  name: string;
  source: string;
  source_commit: string;
  source_file: string | null;
};

type IdentityRow = {
  uuid: string;
  canonical_name: string;
  itsc: string | null;
};

type EventRow = {
  event_type: string;
  source_commit: string;
  uuid: string | null;
  itsc: string | null;
  retired_uuid: string | null;
  survivor_uuid: string | null;
  source_uuid: string | null;
  new_uuid: string | null;
};

type CorrectionRow = {
  correction_type: "split" | "calibration";
  source_commit: string;
  target_uuid: string;
  source_name: string;
  term_code: string | null;
  course_code: string | null;
};

type AssociationRow = {
  name: string;
  term_num: number;
  term_code: string;
  prefix: string;
  courseNumber: string;
};

type PreviousAssociationRow = AssociationRow & { uuid: string };

type ObservedAliasRow = AssociationRow & { alias: string };

type SeedIdentity = {
  uuid: string;
  canonicalName: string;
  itsc?: string;
  aliases?: Array<{
    name: string;
    source: string;
    sourceCommit: string;
    sourceFile?: string;
  }>;
};

type SeedCalibration = {
  sourceName: string;
  courseCode: string;
  termCode?: string;
  instructorUuid: string;
  instructorName?: string;
  sourceCommit: string;
};

type SeedEvent =
  | {
      type: "itsc-added";
      uuid: string;
      itsc: string;
      sourceCommit: string;
    }
  | {
      type: "merge";
      retiredUuid: string;
      retiredName?: string;
      survivorUuid: string;
      survivorName?: string;
      sourceCommit: string;
    }
  | {
      type: "split";
      sourceUuid: string;
      newUuid: string;
      sourceCommit: string;
      newIdentity?: SeedIdentity;
      affectedAssociations?: Array<{
        sourceCommit?: string;
        sourceName: string;
        termCode?: string;
        courseCode: string;
      }>;
    };

function sqlLiteral(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replaceAll("'", "''")}'`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadPreviousParquet(directory: string, initialize: boolean) {
  const required = initialize ? IDENTITY_FILES.slice(0, 2) : IDENTITY_FILES;
  for (const filename of required) {
    const path = join(directory, filename);
    if (!(await exists(path)))
      throw new Error(`Previous identity artifact is missing: ${path}`);
  }
  return {
    identities: join(directory, IDENTITY_FILES[0]).replaceAll("\\", "/"),
    aliases: join(directory, IDENTITY_FILES[1]).replaceAll("\\", "/"),
    events: join(directory, IDENTITY_FILES[2]).replaceAll("\\", "/"),
    corrections: join(directory, IDENTITY_FILES[3]).replaceAll("\\", "/"),
  };
}

async function loadBootstrapJson(path: string) {
  const value = JSON.parse(await readFile(path, "utf8")) as {
    identities?: SeedIdentity[];
    events?: SeedEvent[];
    calibrations?: SeedCalibration[];
  };
  return {
    identities: value.identities ?? [],
    events: value.events ?? [],
    calibrations: value.calibrations ?? [],
  };
}

async function loadPreviousCorrections(
  connection: DuckDBConnection,
  path: string,
  events: EventRow[],
): Promise<CorrectionRow[]> {
  const described = await connection.runAndReadAll(
    `DESCRIBE SELECT * FROM read_parquet('${path}')`,
  );
  const columns = new Set(
    (described.getRowObjectsJson() as Array<{ column_name: string }>).map(
      (column) => column.column_name,
    ),
  );
  if (columns.has("correction_type") && columns.has("target_uuid")) {
    return (
      await connection.runAndReadAll(
        `SELECT correction_type, source_commit, target_uuid, source_name, term_code, course_code FROM read_parquet('${path}')`,
      )
    ).getRowObjectsJson() as CorrectionRow[];
  }
  if (columns.has("new_uuid")) {
    // ponytail: remove this one-release migration adapter after the first typed
    // Ranking Generation is published; old artifacts are not a runtime contract.
    const rows = (
      await connection.runAndReadAll(
        `SELECT source_commit, new_uuid, source_name, term_code, course_code FROM read_parquet('${path}')`,
      )
    ).getRowObjectsJson() as Array<{
      source_commit: string;
      new_uuid: string;
      source_name: string;
      term_code: string | null;
      course_code: string | null;
    }>;
    const splitTargets = new Set(
      events.flatMap((event) =>
        event.event_type === "split" && event.new_uuid ? [event.new_uuid] : [],
      ),
    );
    return rows.map((row) => ({
      correction_type: splitTargets.has(row.new_uuid) ? "split" : "calibration",
      source_commit: row.source_commit,
      target_uuid: row.new_uuid,
      source_name: row.source_name,
      term_code: row.term_code,
      course_code: row.course_code,
    }));
  }
  throw new Error("Invalid Instructor association correction artifact");
}

function eventRows(events: SeedEvent[]): EventRow[] {
  return events.map((event) => {
    if (event.type === "itsc-added")
      return {
        event_type: event.type,
        source_commit: event.sourceCommit,
        uuid: event.uuid,
        itsc: event.itsc,
        retired_uuid: null,
        survivor_uuid: null,
        source_uuid: null,
        new_uuid: null,
      };
    if (event.type === "merge")
      return {
        event_type: event.type,
        source_commit: event.sourceCommit,
        uuid: null,
        itsc: null,
        retired_uuid: event.retiredUuid,
        survivor_uuid: event.survivorUuid,
        source_uuid: null,
        new_uuid: null,
      };
    return {
      event_type: event.type,
      source_commit: event.sourceCommit,
      uuid: null,
      itsc: null,
      retired_uuid: null,
      survivor_uuid: null,
      source_uuid: event.sourceUuid,
      new_uuid: event.newUuid,
    };
  });
}

function splitCorrectionRows(events: SeedEvent[]): CorrectionRow[] {
  const rows: CorrectionRow[] = [];
  for (const event of events) {
    if (event.type !== "split") continue;
    for (const association of event.affectedAssociations ?? []) {
      rows.push({
        correction_type: "split",
        source_commit: association.sourceCommit ?? event.sourceCommit,
        target_uuid: event.newUuid,
        source_name: association.sourceName,
        term_code: association.termCode ?? null,
        course_code: association.courseCode ?? null,
      });
    }
  }
  return rows;
}

function calibrationRows(calibrations: SeedCalibration[]): CorrectionRow[] {
  return calibrations.map((calibration) => ({
    correction_type: "calibration",
    source_commit: calibration.sourceCommit,
    target_uuid: calibration.instructorUuid,
    source_name: calibration.sourceName,
    term_code: calibration.termCode ?? null,
    course_code: calibration.courseCode,
  }));
}

export async function assignInstructorIdentities(
  connection: DuckDBConnection,
  options: {
    previousGenerationDir?: string;
    initialize: boolean;
    sourceCommit: string;
    correctionsPath?: string;
  },
): Promise<void> {
  const associations = (
    await connection.runAndReadAll(`
      SELECT DISTINCT
        links.name,
        links.term_num,
        terms.term_code,
        links.subject AS prefix,
        links.code AS "courseNumber"
      FROM course_term_instructors AS links
      JOIN terms USING (term_num)
      WHERE lower(trim(links.name)) <> 'tba'
      ORDER BY links.name, links.term_num, links.subject, links.code
    `)
  ).getRowObjectsJson() as AssociationRow[];

  const observed = (
    await connection.runAndReadAll(`
      SELECT DISTINCT
        footprints.raw_name AS alias,
        aliases.name,
        footprints.term_num,
        terms.term_code,
        footprints.subject AS prefix,
        footprints.code AS "courseNumber"
      FROM instructor_name_footprints AS footprints
      JOIN instructor_aliases AS aliases
        ON aliases.name_key = instructor_name_key(footprints.raw_name)
      JOIN terms USING (term_num)
      WHERE lower(trim(footprints.raw_name)) <> 'tba'
    `)
  ).getRowObjectsJson() as ObservedAliasRow[];

  let previousIdentities: IdentityRow[] = [];
  let previousAliases: AliasRow[] = [];
  let previousEvents: EventRow[] = [];
  let previousCorrections: CorrectionRow[] = [];
  let previousAssociations: PreviousAssociationRow[] = [];

  if (!options.previousGenerationDir)
    throw new Error("Previous Instructor identities are required");

  {
    const paths = await loadPreviousParquet(
      options.previousGenerationDir,
      options.initialize,
    );
    previousIdentities = (
      await connection.runAndReadAll(
        `SELECT uuid, canonical_name, itsc FROM read_parquet('${paths.identities}')`,
      )
    ).getRowObjectsJson() as IdentityRow[];
    previousAliases = (
      await connection.runAndReadAll(
        `SELECT uuid, name, source, source_commit, source_file FROM read_parquet('${paths.aliases}')`,
      )
    ).getRowObjectsJson() as AliasRow[];
    if (await exists(join(options.previousGenerationDir, IDENTITY_FILES[2]))) {
      previousEvents = (
        await connection.runAndReadAll(
          `SELECT event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid FROM read_parquet('${paths.events}')`,
        )
      ).getRowObjectsJson() as EventRow[];
    }
    if (await exists(join(options.previousGenerationDir, IDENTITY_FILES[3]))) {
      previousCorrections = await loadPreviousCorrections(
        connection,
        paths.corrections,
        previousEvents,
      );
    }
    const previousCourseInstructors = join(
      options.previousGenerationDir,
      "course-instructors.parquet",
    );
    if (await exists(previousCourseInstructors)) {
      previousAssociations = (
        await connection.runAndReadAll(
          `SELECT uuid, name, term_num, term_code, subject AS prefix, code AS "courseNumber" FROM read_parquet('${previousCourseInstructors.replaceAll("\\", "/")}')`,
        )
      ).getRowObjectsJson() as PreviousAssociationRow[];
    }
  }

  const normalized = (value: string) => value.trim().toLocaleLowerCase();
  const identities = new Map(previousIdentities.map((row) => [row.uuid, row]));
  const aliases = [...previousAliases];
  const events = previousEvents;
  const correctionRows = previousCorrections;
  if (options.correctionsPath && (await exists(options.correctionsPath))) {
    const corrections = await loadBootstrapJson(options.correctionsPath);
    const correctionIdentities = [
      ...corrections.identities,
      ...corrections.events.flatMap((event) =>
        event.type === "split" && event.newIdentity ? [event.newIdentity] : [],
      ),
    ];
    const aliasKeys = new Set(
      aliases.map((alias) => `${alias.uuid}\0${normalized(alias.name)}`),
    );
    for (const identity of correctionIdentities) {
      identities.set(identity.uuid, {
        uuid: identity.uuid,
        canonical_name: identity.canonicalName,
        itsc: identity.itsc ?? identities.get(identity.uuid)?.itsc ?? null,
      });
      for (const alias of identity.aliases ?? []) {
        const key = `${identity.uuid}\0${normalized(alias.name)}`;
        if (aliasKeys.has(key)) continue;
        aliasKeys.add(key);
        aliases.push({
          uuid: identity.uuid,
          name: alias.name,
          source: alias.source,
          source_commit: alias.sourceCommit,
          source_file: alias.sourceFile ?? null,
        });
      }
    }
    const eventKeys = new Set(events.map((event) => JSON.stringify(event)));
    for (const event of eventRows(corrections.events)) {
      const key = JSON.stringify(event);
      if (eventKeys.has(key)) continue;
      eventKeys.add(key);
      events.push(event);
    }
    const correctionKeys = new Set(
      correctionRows.map((correction) => JSON.stringify(correction)),
    );
    for (const correction of [
      ...splitCorrectionRows(corrections.events),
      ...calibrationRows(corrections.calibrations),
    ]) {
      const key = JSON.stringify(correction);
      if (correctionKeys.has(key)) continue;
      correctionKeys.add(key);
      correctionRows.push(correction);
    }
  }

  const identityHistoryEvents: InstructorIdentityHistoryEvent[] = events.map(
    (event): InstructorIdentityHistoryEvent => {
      if (event.event_type === "itsc-added" && event.uuid && event.itsc)
        return {
          type: "itsc-added",
          uuid: event.uuid,
          itsc: event.itsc,
          sourceCommit: event.source_commit,
        };
      if (
        event.event_type === "merge" &&
        event.retired_uuid &&
        event.survivor_uuid
      )
        return {
          type: "merge",
          retiredUuid: event.retired_uuid,
          survivorUuid: event.survivor_uuid,
          sourceCommit: event.source_commit,
        };
      if (event.event_type === "split" && event.source_uuid && event.new_uuid)
        return {
          type: "split",
          sourceUuid: event.source_uuid,
          newUuid: event.new_uuid,
          sourceCommit: event.source_commit,
        };
      throw new Error("Invalid Instructor identity event history");
    },
  );
  const associationCorrections: InstructorAssociationCorrection[] =
    correctionRows.map((row) => ({
      correctionType: row.correction_type,
      sourceCommit: row.source_commit,
      targetUuid: row.target_uuid,
      sourceName: row.source_name,
      ...(row.term_code === null ? {} : { termCode: row.term_code }),
      courseCode: row.course_code ?? "",
    }));
  const aliasSourceCommitsByUuid = new Map<string, string[]>();
  for (const alias of aliases) {
    const commits = aliasSourceCommitsByUuid.get(alias.uuid) ?? [];
    commits.push(alias.source_commit);
    aliasSourceCommitsByUuid.set(alias.uuid, commits);
  }
  const identityHistory = buildInstructorIdentityHistory({
    sourceCommit: options.sourceCommit,
    identities: [...identities.values()].map((identity) => ({
      uuid: identity.uuid,
      itsc: identity.itsc,
      aliasSourceCommits: aliasSourceCommitsByUuid.get(identity.uuid) ?? [],
    })),
    events: identityHistoryEvents,
    associationCorrections,
  });
  for (const [uuid, identity] of identities)
    identities.set(uuid, {
      ...identity,
      itsc: identityHistory.itscByUuid.get(uuid) ?? null,
    });

  const candidatesByName = new Map<string, Set<string>>();
  for (const row of [...aliases, ...identities.values()].map((row) => ({
    uuid: row.uuid,
    name: "name" in row ? row.name : row.canonical_name,
  }))) {
    const candidates = candidatesByName.get(normalized(row.name)) ?? new Set();
    candidates.add(identityHistory.resolveUuid(row.uuid));
    candidatesByName.set(normalized(row.name), candidates);
  }
  const sourceAliasesByCanonical = new Map<string, Set<string>>();
  for (const row of observed) {
    const aliases =
      sourceAliasesByCanonical.get(normalized(row.name)) ?? new Set<string>();
    aliases.add(row.alias);
    sourceAliasesByCanonical.set(normalized(row.name), aliases);
  }

  function resolveAssociation(row: AssociationRow): {
    uuid: string;
    corrected: boolean;
  } {
    const courseCode = `${row.prefix} ${row.courseNumber}`;
    const query = {
      sourceName: row.name,
      sourceAliases: [
        ...(sourceAliasesByCanonical.get(normalized(row.name)) ?? []),
      ],
      termCode: row.term_code,
      courseCode,
    };
    const directResolution = identityHistory.resolveAssociation(query);
    if (directResolution.status === "resolved")
      return {
        uuid: directResolution.uuid,
        corrected: Boolean(directResolution.correction),
      };

    const candidates = candidatesByName.get(normalized(row.name));
    if (!candidates?.size)
      throw new Error(`Unmatched Instructor identity: ${row.name}`);

    let candidateUuid =
      candidates.size === 1 ? ([...candidates][0] as string) : undefined;
    if (!candidateUuid) {
      const evidenceMatches = new Set([
        ...observed.flatMap((item) => {
          const aliasCandidates = candidatesByName.get(normalized(item.alias));
          return normalized(item.name) === normalized(row.name) &&
            item.term_code === row.term_code &&
            item.prefix === row.prefix &&
            item.courseNumber === row.courseNumber &&
            aliasCandidates?.size === 1
            ? [...aliasCandidates].filter((uuid) => candidates.has(uuid))
            : [];
        }),
        ...previousAssociations.flatMap((item) =>
          candidates.has(identityHistory.resolveUuid(item.uuid)) &&
          item.term_code === row.term_code &&
          item.prefix === row.prefix &&
          item.courseNumber === row.courseNumber
            ? [identityHistory.resolveUuid(item.uuid)]
            : [],
        ),
      ]);
      if (evidenceMatches.size === 1)
        candidateUuid = [...evidenceMatches][0] as string;
    }

    if (candidateUuid) {
      const resolution = identityHistory.resolveAssociation({
        ...query,
        uuid: candidateUuid,
      });
      if (resolution.status === "resolved")
        return {
          uuid: resolution.uuid,
          corrected: Boolean(resolution.correction),
        };
    }
    throw new Error(
      `Ambiguous Instructor identity: ${row.name}, ${row.term_code}, ${courseCode}`,
    );
  }

  const assignments = associations.map((row) => ({
    ...row,
    ...resolveAssociation(row),
  }));
  const currentNamesByUuid = new Map<string, Set<string>>();
  const mergedSurvivors = new Set(
    [...identityHistory.redirectByUuid.keys()].map((uuid) =>
      identityHistory.resolveUuid(uuid),
    ),
  );
  for (const { name, uuid, corrected } of assignments) {
    if (!identities.has(uuid))
      throw new Error(`Unknown Instructor UUID: ${uuid}`);
    if (corrected) continue;
    const names = currentNamesByUuid.get(uuid) ?? new Set<string>();
    names.add(name);
    currentNamesByUuid.set(uuid, names);
  }
  for (const [uuid, names] of currentNamesByUuid) {
    if (names.size > 1 && !mergedSurvivors.has(uuid))
      throw new Error(
        `Ambiguous Instructor identity ${uuid}: ${[...names].join(", ")}`,
      );
    const current = identities.get(uuid) as IdentityRow;
    identities.set(uuid, {
      ...current,
      canonical_name: names.has(current.canonical_name)
        ? current.canonical_name
        : ([...names].sort()[0] as string),
    });
  }

  const aliasKeys = new Set(
    aliases.map((alias) => `${alias.uuid}\0${normalized(alias.name)}`),
  );
  for (const row of observed) {
    const { uuid } = resolveAssociation(row);
    const key = `${uuid}\0${normalized(row.alias)}`;
    if (aliasKeys.has(key)) continue;
    aliasKeys.add(key);
    aliases.push({
      uuid,
      name: row.alias,
      source: "ranking-generation",
      source_commit: options.sourceCommit,
      source_file: "instructor-ratings.parquet",
    });
  }

  const identityList = [...identities.values()].sort((a, b) =>
    a.canonical_name.localeCompare(b.canonical_name),
  );
  const aliasList = aliases.sort(
    (a, b) => a.uuid.localeCompare(b.uuid) || a.name.localeCompare(b.name),
  );

  await connection.run(`
    CREATE OR REPLACE TABLE instructor_identities (
      uuid VARCHAR,
      canonical_name VARCHAR,
      itsc VARCHAR
    );
    CREATE OR REPLACE TABLE instructor_identity_aliases (
      uuid VARCHAR,
      name VARCHAR,
      source VARCHAR,
      source_commit VARCHAR,
      source_file VARCHAR
    );
    CREATE OR REPLACE TABLE instructor_identity_events (
      event_type VARCHAR,
      source_commit VARCHAR,
      uuid VARCHAR,
      itsc VARCHAR,
      retired_uuid VARCHAR,
      survivor_uuid VARCHAR,
      source_uuid VARCHAR,
      new_uuid VARCHAR
    );
    CREATE OR REPLACE TABLE instructor_identity_association_corrections (
      correction_type VARCHAR,
      source_commit VARCHAR,
      target_uuid VARCHAR,
      source_name VARCHAR,
      term_code VARCHAR,
      course_code VARCHAR
    );
    CREATE OR REPLACE TABLE instructor_identity_assignments (
      name VARCHAR,
      uuid VARCHAR,
      term_num INTEGER,
      subject VARCHAR,
      code VARCHAR
    );
  `);

  if (identityList.length > 0) {
    const values = identityList
      .map(
        (row) =>
          `(${sqlLiteral(row.uuid)}, ${sqlLiteral(row.canonical_name)}, ${sqlLiteral(row.itsc)})`,
      )
      .join(",\n");
    await connection.run(`INSERT INTO instructor_identities VALUES ${values}`);
  }
  if (aliasList.length > 0) {
    const values = aliasList
      .map(
        (row) =>
          `(${sqlLiteral(row.uuid)}, ${sqlLiteral(row.name)}, ${sqlLiteral(row.source)}, ${sqlLiteral(row.source_commit)}, ${sqlLiteral(row.source_file)})`,
      )
      .join(",\n");
    await connection.run(
      `INSERT INTO instructor_identity_aliases VALUES ${values}`,
    );
  }
  if (assignments.length > 0) {
    const values = assignments
      .map(
        (row) =>
          `(${sqlLiteral(row.name)}, ${sqlLiteral(row.uuid)}, ${row.term_num}, ${sqlLiteral(row.prefix)}, ${sqlLiteral(row.courseNumber)})`,
      )
      .join(",\n");
    await connection.run(
      `INSERT INTO instructor_identity_assignments VALUES ${values}`,
    );
  }
  if (events.length > 0) {
    const values = events
      .map(
        (row) =>
          `(${sqlLiteral(row.event_type)}, ${sqlLiteral(row.source_commit)}, ${sqlLiteral(row.uuid)}, ${sqlLiteral(row.itsc)}, ${sqlLiteral(row.retired_uuid)}, ${sqlLiteral(row.survivor_uuid)}, ${sqlLiteral(row.source_uuid)}, ${sqlLiteral(row.new_uuid)})`,
      )
      .join(",\n");
    await connection.run(
      `INSERT INTO instructor_identity_events VALUES ${values}`,
    );
  }
  if (correctionRows.length > 0) {
    const values = correctionRows
      .map(
        (row) =>
          `(${sqlLiteral(row.correction_type)}, ${sqlLiteral(row.source_commit)}, ${sqlLiteral(row.target_uuid)}, ${sqlLiteral(row.source_name)}, ${sqlLiteral(row.term_code)}, ${sqlLiteral(row.course_code)})`,
      )
      .join(",\n");
    await connection.run(
      `INSERT INTO instructor_identity_association_corrections VALUES ${values}`,
    );
  }

  await connection.run(`
    CREATE OR REPLACE TABLE observation_instructor_identities AS
    SELECT DISTINCT bridge.observation_id, assignments.uuid
    FROM observation_instructors AS bridge
    JOIN observations USING (observation_id)
    JOIN instructor_identity_assignments AS assignments
      ON assignments.name = bridge.name
     AND assignments.term_num = observations.term_num
     AND assignments.subject = observations.subject
     AND assignments.code = observations.code;

    CREATE OR REPLACE TABLE resolved_schedule_teaching_assignments AS
    SELECT DISTINCT assignments.uuid, assignments.term_num
    FROM schedule_teaching_assignments AS schedule
    JOIN instructor_identity_assignments AS assignments
      USING (name, term_num, subject, code);

    CREATE OR REPLACE TABLE resolved_instructor_entities AS
    SELECT assignments.uuid, identities.canonical_name AS name,
      min(assignments.term_num)::INTEGER AS min_term_num
    FROM instructor_identity_assignments AS assignments
    JOIN instructor_identities AS identities USING (uuid)
    GROUP BY assignments.uuid, identities.canonical_name;
  `);
}
