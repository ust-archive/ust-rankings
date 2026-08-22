import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";

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

type AffectedRow = {
  source_commit: string;
  new_uuid: string;
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
      survivorUuid: string;
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
        courseCode?: string;
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
    affected: join(directory, IDENTITY_FILES[3]).replaceAll("\\", "/"),
  };
}

async function loadBootstrapJson(path: string) {
  const value = JSON.parse(await readFile(path, "utf8")) as {
    identities?: SeedIdentity[];
    events?: SeedEvent[];
  };
  return {
    identities: value.identities ?? [],
    events: value.events ?? [],
  };
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

function affectedRows(events: SeedEvent[]): AffectedRow[] {
  const rows: AffectedRow[] = [];
  for (const event of events) {
    if (event.type !== "split") continue;
    for (const association of event.affectedAssociations ?? []) {
      rows.push({
        source_commit: association.sourceCommit ?? event.sourceCommit,
        new_uuid: event.newUuid,
        source_name: association.sourceName,
        term_code: association.termCode ?? null,
        course_code: association.courseCode ?? null,
      });
    }
  }
  return rows;
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
  let previousAffected: AffectedRow[] = [];
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
      previousAffected = (
        await connection.runAndReadAll(
          `SELECT source_commit, new_uuid, source_name, term_code, course_code FROM read_parquet('${paths.affected}')`,
        )
      ).getRowObjectsJson() as AffectedRow[];
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

  const identities = new Map(previousIdentities.map((row) => [row.uuid, row]));
  const aliases = [...previousAliases];
  let events = previousEvents;
  let affected = previousAffected;
  if (options.correctionsPath && (await exists(options.correctionsPath))) {
    const corrections = await loadBootstrapJson(options.correctionsPath);
    for (const identity of corrections.identities) {
      identities.set(identity.uuid, {
        uuid: identity.uuid,
        canonical_name: identity.canonicalName,
        itsc: identity.itsc ?? identities.get(identity.uuid)?.itsc ?? null,
      });
    }
    events = [...events, ...eventRows(corrections.events)];
    affected = [...affected, ...affectedRows(corrections.events)];
    for (const event of corrections.events) {
      if (event.type === "itsc-added") {
        const current = identities.get(event.uuid);
        if (current)
          identities.set(event.uuid, { ...current, itsc: event.itsc });
      }
    }
  }

  const normalized = (value: string) => value.trim().toLocaleLowerCase();
  const mergeRedirects = new Map(
    events.flatMap((event) =>
      event.event_type === "merge" &&
      event.retired_uuid !== null &&
      event.survivor_uuid !== null
        ? [[event.retired_uuid, event.survivor_uuid]]
        : [],
    ),
  );
  const survivingUuid = (uuid: string) => {
    const visited = new Set<string>();
    let current = uuid;
    while (mergeRedirects.has(current)) {
      if (visited.has(current)) throw new Error("Cyclic Instructor merge");
      visited.add(current);
      current = mergeRedirects.get(current) as string;
    }
    return current;
  };
  const candidatesByName = new Map<string, Set<string>>();
  for (const row of [...aliases, ...identities.values()].map((row) => ({
    uuid: row.uuid,
    name: "name" in row ? row.name : row.canonical_name,
  }))) {
    const candidates = candidatesByName.get(normalized(row.name)) ?? new Set();
    candidates.add(survivingUuid(row.uuid));
    candidatesByName.set(normalized(row.name), candidates);
  }
  const canonicalByAlias = new Map(
    observed.map((row) => [normalized(row.alias), row.name]),
  );

  function resolveAssociation(row: AssociationRow): string {
    const candidates = candidatesByName.get(normalized(row.name));
    if (!candidates?.size)
      throw new Error(`Unmatched Instructor identity: ${row.name}`);
    if (candidates.size === 1) return [...candidates][0] as string;

    const courseCode = `${row.prefix} ${row.courseNumber}`;
    const correctedMatches = new Set(
      affected.flatMap((item) =>
        candidates.has(survivingUuid(item.new_uuid)) &&
        normalized(
          canonicalByAlias.get(normalized(item.source_name)) ??
            item.source_name,
        ) === normalized(row.name) &&
        item.term_code === row.term_code &&
        item.course_code === courseCode
          ? [survivingUuid(item.new_uuid)]
          : [],
      ),
    );
    if (correctedMatches.size === 1) return [...correctedMatches][0] as string;
    if (correctedMatches.size > 1)
      throw new Error(
        `Ambiguous Instructor identity: ${row.name}, ${row.term_code}, ${courseCode}`,
      );

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
        candidates.has(survivingUuid(item.uuid)) &&
        item.term_code === row.term_code &&
        item.prefix === row.prefix &&
        item.courseNumber === row.courseNumber
          ? [survivingUuid(item.uuid)]
          : [],
      ),
    ]);
    if (evidenceMatches.size === 1) return [...evidenceMatches][0] as string;
    throw new Error(
      `Ambiguous Instructor identity: ${row.name}, ${row.term_code}, ${courseCode}`,
    );
  }

  const assignments = associations.map((row) => ({
    ...row,
    uuid: resolveAssociation(row),
  }));
  const currentNameByUuid = new Map<string, string>();
  for (const { name, uuid } of assignments) {
    if (!identities.has(uuid))
      throw new Error(`Unknown Instructor UUID: ${uuid}`);
    const claimedName = currentNameByUuid.get(uuid);
    if (claimedName && claimedName !== name)
      throw new Error(
        `Ambiguous Instructor identity ${uuid}: ${claimedName}, ${name}`,
      );
    currentNameByUuid.set(uuid, name);
    const current = identities.get(uuid);
    if (current) identities.set(uuid, { ...current, canonical_name: name });
  }

  const aliasKeys = new Set(
    aliases.map((alias) => `${alias.uuid}\0${normalized(alias.name)}`),
  );
  for (const row of observed) {
    const uuid = resolveAssociation(row);
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
    CREATE OR REPLACE TABLE instructor_split_affected_associations (
      source_commit VARCHAR,
      new_uuid VARCHAR,
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
  if (affected.length > 0) {
    const values = affected
      .map(
        (row) =>
          `(${sqlLiteral(row.source_commit)}, ${sqlLiteral(row.new_uuid)}, ${sqlLiteral(row.source_name)}, ${sqlLiteral(row.term_code)}, ${sqlLiteral(row.course_code)})`,
      )
      .join(",\n");
    await connection.run(
      `INSERT INTO instructor_split_affected_associations VALUES ${values}`,
    );
  }

  await connection.run(`
    CREATE OR REPLACE TABLE observation_instructor_identities AS
    SELECT DISTINCT bridge.observation_id, assignments.uuid, assignments.name
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
