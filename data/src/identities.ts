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

async function loadPreviousParquet(directory: string) {
  const identitiesPath = join(directory, "instructor-identities.parquet");
  if (!(await exists(identitiesPath)))
    throw new Error(`Previous identities are missing: ${identitiesPath}`);
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
    bootstrapPath?: string;
    requirePrevious: boolean;
    sourceCommit: string;
    correctionsPath?: string;
  },
): Promise<void> {
  const names = (
    await connection.runAndReadAll(`
      SELECT DISTINCT name AS canonical_name
      FROM instructor_entities
      WHERE lower(trim(name)) <> 'tba'
      ORDER BY name
    `)
  ).getRowObjectsJson() as Array<{ canonical_name: string }>;

  const observed = (
    await connection.runAndReadAll(`
      SELECT DISTINCT
        anchors.name AS name,
        aliases.name AS canonical_name
      FROM instructor_name_anchors AS anchors
      JOIN instructor_aliases AS aliases
        ON aliases.name_key = anchors.name_key
      WHERE lower(trim(anchors.name)) <> 'tba'
    `)
  ).getRowObjectsJson() as Array<{ name: string; canonical_name: string }>;

  let previousIdentities: IdentityRow[] = [];
  let previousAliases: AliasRow[] = [];
  let previousEvents: EventRow[] = [];
  let previousAffected: AffectedRow[] = [];

  if (options.previousGenerationDir) {
    const paths = await loadPreviousParquet(options.previousGenerationDir);
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
  } else if (options.bootstrapPath) {
    const seed = await loadBootstrapJson(options.bootstrapPath);
    previousIdentities = seed.identities.map((identity) => ({
      uuid: identity.uuid,
      canonical_name: identity.canonicalName,
      itsc: identity.itsc ?? null,
    }));
    previousAliases = seed.identities.flatMap((identity) =>
      (identity.aliases ?? []).map((alias) => ({
        uuid: identity.uuid,
        name: alias.name,
        source: alias.source,
        source_commit: alias.sourceCommit,
        source_file: alias.sourceFile ?? null,
      })),
    );
    previousEvents = eventRows(seed.events);
    previousAffected = affectedRows(seed.events);
  } else if (options.requirePrevious) {
    throw new Error(
      "Previous identities are required after bootstrap and were not provided",
    );
  } else {
    throw new Error(
      "Previous identities or an identity bootstrap file is required",
    );
  }

  const byName = new Map<string, string>();
  for (const alias of previousAliases) {
    const key = alias.name.trim().toLocaleLowerCase();
    const existing = byName.get(key);
    if (existing && existing !== alias.uuid)
      throw new Error(`Ambiguous Instructor alias ${alias.name}`);
    byName.set(key, alias.uuid);
  }
  for (const identity of previousIdentities) {
    const key = identity.canonical_name.trim().toLocaleLowerCase();
    const existing = byName.get(key);
    if (existing && existing !== identity.uuid)
      throw new Error(
        `Ambiguous Instructor canonical name ${identity.canonical_name}`,
      );
    byName.set(key, identity.uuid);
  }

  const identities = new Map(previousIdentities.map((row) => [row.uuid, row]));
  const aliases = [...previousAliases];

  const currentNameByUuid = new Map<string, string>();
  for (const { canonical_name } of names) {
    const key = canonical_name.trim().toLocaleLowerCase();
    const uuid = byName.get(key);
    if (!uuid)
      throw new Error(`Unmatched Instructor identity: ${canonical_name}`);
    if (!identities.has(uuid))
      throw new Error(`Unknown Instructor UUID: ${uuid}`);
    const claimedName = currentNameByUuid.get(uuid);
    if (claimedName && claimedName !== canonical_name)
      throw new Error(
        `Ambiguous Instructor identity ${uuid}: ${claimedName}, ${canonical_name}`,
      );
    currentNameByUuid.set(uuid, canonical_name);
    const current = identities.get(uuid);
    if (current) identities.set(uuid, { ...current, canonical_name });
  }

  const aliasKeys = new Set(
    aliases.map((alias) => `${alias.uuid}\0${alias.name.toLocaleLowerCase()}`),
  );
  for (const row of observed) {
    const uuid = byName.get(row.canonical_name.trim().toLocaleLowerCase());
    if (!uuid) continue;
    const key = `${uuid}\0${row.name.toLocaleLowerCase()}`;
    if (aliasKeys.has(key)) continue;
    aliasKeys.add(key);
    aliases.push({
      uuid,
      name: row.name,
      source: "ranking-generation",
      source_commit: options.sourceCommit,
      source_file: "instructor-ratings.parquet",
    });
  }

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
}
