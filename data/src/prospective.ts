import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { prepareObservationContexts } from "./backtest-analysis.ts";
import { assignInstructorIdentities } from "./identities.ts";
import {
  evaluateProspective,
  type ForecastRow,
  type OutcomeRow,
} from "./prospective-evaluate.ts";
import {
  assertRegisteredSeal,
  claimEvaluation,
  createProtocol,
  readProtocol,
  readSeal,
  registerSeal,
  type SourceFile,
  sealBundle,
  sha256,
  verifySourceFiles,
} from "./prospective-seal.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceNames = {
  catalog_courses: "catalog-courses.parquet",
  schedule_classes: "schedule-classes.parquet",
  schedule_courses: "schedule-courses.parquet",
  schedule_class_records: "schedule-class-records.parquet",
  schedule_course_records: "schedule-course-records.parquet",
  reviews: "reviews.parquet",
  sfq_instructors: "sfq-instructors.parquet",
  sfq_sections: "sfq-sections.parquet",
} as const;
const previousNames = [
  "instructor-identities.parquet",
  "instructor-aliases.parquet",
  "instructor-identity-events.parquet",
  "instructor-split-affected-associations.parquet",
  "course-instructors.parquet",
] as const;
const outcomeSourceNames = new Set([
  "reviews.parquet",
  "sfq-instructors.parquet",
  "sfq-sections.parquet",
]);

function registryDirectory() {
  const commonGitDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  return join(commonGitDirectory, "rankings-prospective-receipts");
}

type IdentitySnapshot = { uuids: string[]; aliases: Record<string, string> };
type ModelForecast = Omit<
  ForecastRow,
  "historySamples" | "historicalCourseCount"
>;
type ForecastMetadata = {
  kind: "forecast";
  protocolSha256: string;
  cutoffTerm: number;
  forecasts: ForecastRow[];
  identities: IdentitySnapshot;
  populationCourseIds: string[];
};
type OutcomeMetadata = {
  kind: "outcomes";
  protocolSha256: string;
  forecastSeals: string[];
  outcomes: OutcomeRow[];
};
export type ForecastConfig = {
  protocolPath: string;
  cutoffTerm: number;
  files: SourceFile[];
};
export type OutcomeConfig = {
  protocolPath: string;
  forecastSeals: Array<{ directory: string; sha256: string }>;
  files: SourceFile[];
};

async function sql(connection: DuckDBConnection, name: string) {
  await connection.run(await readFile(join(root, "sql", name), "utf8"));
}

async function setVariables(
  connection: DuckDBConnection,
  variables: Record<string, string | number | boolean>,
) {
  for (const [key, value] of Object.entries(variables))
    await connection.run(`SET VARIABLE ${key} = $value`, { value });
}

async function withSources<T>(
  files: SourceFile[],
  action: (
    connection: DuckDBConnection,
    sources: Record<string, string>,
  ) => Promise<T>,
): Promise<T> {
  await verifySourceFiles(files);
  const snapshot = await mkdtemp(
    join(tmpdir(), "rankings-prospective-sources-"),
  );
  // Fit only from private verified bytes, never a mutable caller-owned path.
  try {
    for (const file of files) {
      const bytes = await readFile(file.path);
      if (sha256(bytes) !== file.sha256)
        throw new Error(`Source hash changed: ${file.name}`);
      await writeFile(join(snapshot, file.name), bytes, { flag: "wx" });
    }
    const sources = Object.fromEntries(
      Object.entries(sourceNames).map(([variable, name]) => {
        const file = files.find((file) => file.name === name);
        if (!file) throw new Error(`Missing required source: ${name}`);
        return [variable, join(snapshot, file.name).replaceAll("\\", "/")];
      }),
    );
    const instance = await DuckDBInstance.create();
    const connection = await instance.connect();
    try {
      await connection.run("SET threads = 1");
      await setVariables(connection, {
        ...sources,
        timeliness_base: 0.65,
        course_instructor_multiplier: 12,
        review_vote_scale: 1,
        sfq_rate_penalty: 1,
        context_affects_uncertainty: true,
      });
      const result = await action(connection, sources);
      // Recheck inputs after reading, before a seal can be accepted.
      await verifySourceFiles(files);
      return result;
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

async function assertPastOnly(connection: DuckDBConnection, cutoff: number) {
  for (const variable of Object.keys(sourceNames)) {
    const term =
      variable === "reviews"
        ? `4 * try_cast(substring(semester, 3, 2) AS INTEGER)
        + CASE split_part(semester, ' ', 2)
          WHEN 'Fall' THEN 0 WHEN 'Winter' THEN 1
          WHEN 'Spring' THEN 2 WHEN 'Summer' THEN 3 END`
        : "term_num";
    const rows = (
      await connection.runAndReadAll(
        `
      SELECT count(*)::INTEGER AS invalid
      FROM read_parquet(getvariable('${variable}'))
      WHERE (${term}) IS NULL OR (${term}) > $cutoff
    `,
        { cutoff },
      )
    ).getRowObjectsJS();
    if (rows[0]?.invalid !== 0)
      throw new Error(
        `${variable} contains unknown or future training Terms after ${cutoff}`,
      );
  }
}

function checkAcquisition(files: SourceFile[], after?: string) {
  const now = Date.now();
  for (const file of files) {
    const acquired = Date.parse(file.acquiredAt);
    if (
      !Number.isFinite(acquired) ||
      acquired > now ||
      (after !== undefined && acquired <= Date.parse(after))
    )
      throw new Error(`Invalid acquisition chronology: ${file.name}`);
  }
}

export async function writeForecastSeal(
  directory: string,
  config: ForecastConfig,
) {
  const { protocol, sha256: protocolSha256 } = await readProtocol(
    config.protocolPath,
  );
  if (
    !Number.isSafeInteger(config.cutoffTerm) ||
    config.cutoffTerm < protocol.knownOutcomeCeilingTerm
  )
    throw new Error(
      "Forecast cutoff must follow the declared inspected history",
    );
  checkAcquisition(config.files);
  const expectedNames = [
    ...Object.values(sourceNames),
    ...previousNames.map((name) => `previous-${name}`),
  ];
  if (
    config.files.length !== expectedNames.length ||
    expectedNames.some(
      (name) => !config.files.some((file) => file.name === name),
    )
  )
    throw new Error(
      "Forecasts require exactly the eight sources and five previous identity artifacts",
    );
  const previous = await mkdtemp(
    join(tmpdir(), "rankings-prospective-identities-"),
  );
  try {
    await verifySourceFiles(config.files);
    for (const name of previousNames) {
      const file = config.files.find(
        (file) => file.name === `previous-${name}`,
      );
      if (!file) throw new Error(`Missing previous ${name}`);
      await copyFile(file.path, join(previous, name));
      if (sha256(await readFile(join(previous, name))) !== file.sha256)
        throw new Error(`Previous identity bytes changed: ${name}`);
    }
    const metadata = await withSources(
      config.files,
      async (connection): Promise<ForecastMetadata> => {
        await assertPastOnly(connection, config.cutoffTerm);
        await sql(connection, "00_sources.sql");
        await sql(connection, "10_observations.sql");
        // Dense history can be extended without fabricating teaching assignments.
        await connection.run(
          `
        INSERT INTO terms SELECT term_num::INTEGER,
          printf('%02d%d0', floor(term_num / 4)::INTEGER, term_num % 4 + 1)
        FROM range((SELECT max(term_num) + 1 FROM terms), $cutoff + 1) AS t(term_num)
      `,
          { cutoff: config.cutoffTerm },
        );
        await connection.run(`
        CREATE OR REPLACE TABLE course_terms AS
        SELECT subject, code, term_num FROM course_entities
        JOIN terms ON term_num >= min_term_num
      `);
        const previousTerms = (
          await connection.runAndReadAll(
            "SELECT count(*)::INTEGER AS invalid FROM read_parquet($path) WHERE term_num > $cutoff",
            {
              path: join(previous, "course-instructors.parquet"),
              cutoff: config.cutoffTerm,
            },
          )
        ).getRowObjectsJS();
        if (previousTerms[0]?.invalid !== 0)
          throw new Error(
            "Previous identity associations include future Terms",
          );
        await assignInstructorIdentities(connection, {
          previousGenerationDir: previous,
          initialize: false,
          sourceCommit:
            config.files.find(
              (file) => file.name === "previous-instructor-identities.parquet",
            )?.revision ?? "",
        });
        const identityRows = (
          await connection.runAndReadAll(
            "SELECT uuid FROM instructor_identities ORDER BY uuid",
          )
        ).getRowObjectsJson() as Array<{ uuid: string }>;
        // Future aliases cannot add identity knowledge. Ambiguous exact names stay unknown.
        const aliases = (
          await connection.runAndReadAll(`
        SELECT lower(trim(name)) AS name, min(uuid) AS uuid
        FROM instructor_identity_aliases GROUP BY lower(trim(name))
        HAVING count(DISTINCT uuid) = 1 ORDER BY name
      `)
        ).getRowObjectsJson() as Array<{ name: string; uuid: string }>;
        const forecasts: ModelForecast[] = [];
        for (const candidate of protocol.candidateRegistry) {
          const settings = candidate.parameters;
          await setVariables(connection, {
            timeliness_base: settings.timelinessBase,
            course_instructor_multiplier: settings.courseInstructorMultiplier,
            review_vote_scale: settings.reviewVoteScale,
            sfq_rate_penalty: settings.sfqRatePenalty,
            context_affects_uncertainty: settings.contextAffectsUncertainty,
          });
          await sql(connection, "11_backtest_weights.sql");
          await sql(connection, "20_ratings.sql");
          forecasts.push(
            ...((
              await connection.runAndReadAll(
                `
          SELECT $candidate AS "candidateId", ratings.term_num AS "cutoffTerm",
            family,
            CASE WHEN family = 'course' THEN subject || ' ' || code
              ELSE entity_id END AS "entityId",
            ratings.criterion,
            bayesian * stats.stddev + stats.mean AS prediction,
            posterior_stddev * stats.stddev AS "modelStddev"
          FROM scored_entity_ratings AS ratings
          JOIN criterion_stats AS stats USING (term_num, criterion)
          WHERE ratings.term_num = $cutoff AND stats.stddev > 0
            AND ((family = 'course' AND ratings.criterion <> 'instructor')
              OR (family = 'instructor' AND ratings.criterion = 'instructor'))
          ORDER BY family, "entityId", criterion
        `,
                { candidate: candidate.id, cutoff: config.cutoffTerm },
              )
            ).getRowObjectsJson() as ModelForecast[]),
          );
          if (candidate.role === "control") {
            forecasts.push(
              ...((
                await connection.runAndReadAll(
                  `
            WITH history AS (
              SELECT 'course' AS family, subject || ' ' || code AS entity_id,
                criterion, term_num, rating FROM observations
              WHERE criterion <> 'instructor' AND term_num <= $cutoff
              UNION ALL
              SELECT 'instructor', identities.uuid, observations.criterion,
                observations.term_num, observations.rating
              FROM sfq_instructor_observations AS observations
              JOIN observation_instructor_identities AS identities USING (observation_id)
              WHERE observations.term_num <= $cutoff
            ), ranked_history AS (
              SELECT *, max(term_num) OVER (PARTITION BY family, entity_id, criterion) AS latest_term
              FROM history
            ), baselines AS (
              SELECT family, entity_id, criterion, avg(rating) AS rolling,
                avg(rating) FILTER (WHERE term_num = latest_term) AS latest
              FROM ranked_history GROUP BY family, entity_id, criterion
            ), predictions AS (
              SELECT family, CASE WHEN family = 'course' THEN subject || ' ' || code
                  ELSE ratings.entity_id END AS entity_id,
                ratings.criterion, stats.mean AS population,
                coalesce(rating * stats.stddev + stats.mean, stats.mean) AS unshrunk,
                posterior_stddev * stats.stddev AS model_stddev
              FROM scored_entity_ratings AS ratings
              JOIN criterion_stats AS stats USING (term_num, criterion)
              WHERE term_num = $cutoff AND stats.stddev > 0
                AND ((family = 'course' AND criterion <> 'instructor')
                  OR (family = 'instructor' AND criterion = 'instructor'))
            )
            SELECT baseline.id AS "candidateId", $cutoff::INTEGER AS "cutoffTerm",
              predictions.family, predictions.entity_id AS "entityId", predictions.criterion,
              baseline.prediction, model_stddev AS "modelStddev"
            FROM predictions LEFT JOIN baselines USING (family, entity_id, criterion),
            LATERAL (VALUES ('population', population), ('unshrunk', unshrunk),
              ('latest', coalesce(latest, population)), ('rolling', coalesce(rolling, population)))
              AS baseline(id, prediction)
            ORDER BY "candidateId", family, "entityId", criterion
          `,
                  { cutoff: config.cutoffTerm },
                )
              ).getRowObjectsJson() as ModelForecast[]),
            );
          }
        }
        if (!forecasts.length)
          throw new Error("No finite forecasts at the selected cutoff");
        const history = (
          await connection.runAndReadAll(
            `
          SELECT 'course' AS family, subject || ' ' || code AS entity_id, criterion,
            sum(samples)::DOUBLE AS "historySamples", 0::INTEGER AS "historicalCourseCount"
          FROM observations WHERE criterion <> 'instructor' AND term_num <= $cutoff
          GROUP BY subject, code, criterion
          UNION ALL
          SELECT 'instructor', identities.uuid, observations.criterion,
            sum(observations.samples)::DOUBLE,
            count(DISTINCT observations.subject || ' ' || observations.code)::INTEGER
          FROM sfq_instructor_observations AS observations
          JOIN observation_instructor_identities AS identities USING (observation_id)
          WHERE observations.term_num <= $cutoff
          GROUP BY identities.uuid, observations.criterion
        `,
            { cutoff: config.cutoffTerm },
          )
        ).getRowObjectsJson() as Array<{
          family: string;
          entity_id: string;
          criterion: string;
          historySamples: number;
          historicalCourseCount: number;
        }>;
        const historyByEntity = new Map(
          history.map((row) => [
            JSON.stringify([row.family, row.entity_id, row.criterion]),
            row,
          ]),
        );
        const population = (
          await connection.runAndReadAll(
            `
          SELECT DISTINCT subject || ' ' || code AS id FROM schedule_course_terms
          WHERE term_num = $cutoff ORDER BY id
        `,
            { cutoff: config.cutoffTerm },
          )
        ).getRowObjectsJson() as Array<{ id: string }>;
        return {
          kind: "forecast",
          protocolSha256,
          cutoffTerm: config.cutoffTerm,
          forecasts: forecasts.map((row) => {
            const history = historyByEntity.get(
              JSON.stringify([row.family, row.entityId, row.criterion]),
            );
            return {
              ...row,
              historySamples: history?.historySamples ?? 0,
              historicalCourseCount: history?.historicalCourseCount ?? 0,
            };
          }),
          populationCourseIds: population.map((row) => row.id),
          identities: {
            uuids: identityRows.map((row) => row.uuid),
            aliases: Object.fromEntries(
              aliases.map((row) => [row.name, row.uuid]),
            ),
          },
        };
      },
    );
    const seal = await sealBundle(directory, metadata, config.files);
    await registerSeal(
      registryDirectory(),
      seal.sha256,
      "forecast",
      protocolSha256,
      seal.sealedAt,
    );
    return seal;
  } finally {
    await rm(previous, { recursive: true, force: true });
  }
}

async function loadForecasts(
  protocolPath: string,
  references: OutcomeConfig["forecastSeals"],
) {
  const { protocol, sha256: protocolSha256 } = await readProtocol(protocolPath);
  if (!references.length)
    throw new Error("At least one forecast seal is required");
  const seals = await Promise.all(
    references.map(async ({ directory, sha256 }) => {
      const seal = await readSeal<ForecastMetadata>(directory);
      if (seal.sha256 !== sha256)
        throw new Error("Forecast seal hash mismatch");
      await assertRegisteredSeal(
        registryDirectory(),
        seal.sha256,
        "forecast",
        protocolSha256,
        seal.sealedAt,
      );
      return seal;
    }),
  );
  const cutoffs = new Set<number>();
  for (const seal of seals) {
    if (
      seal.metadata.kind !== "forecast" ||
      seal.metadata.protocolSha256 !== protocolSha256
    )
      throw new Error("Forecast protocol mismatch");
    if (cutoffs.has(seal.metadata.cutoffTerm))
      throw new Error("Duplicate forecast cutoff seal");
    cutoffs.add(seal.metadata.cutoffTerm);
    if (Date.parse(seal.sealedAt) < Date.parse(protocol.createdAt))
      throw new Error("Forecast predates its protocol");
  }
  return { protocol, protocolSha256, seals };
}

export async function writeOutcomeSeal(
  directory: string,
  config: OutcomeConfig,
) {
  const { protocol, protocolSha256, seals } = await loadForecasts(
    config.protocolPath,
    config.forecastSeals,
  );
  if (config.files.length !== Object.keys(sourceNames).length)
    throw new Error("Outcomes require exactly the eight source artifacts");
  const registrations = await Promise.all(
    seals.map((seal) =>
      assertRegisteredSeal(
        registryDirectory(),
        seal.sha256,
        "forecast",
        protocolSha256,
        seal.sealedAt,
      ),
    ),
  );
  const latestSealTime = registrations
    .map((registration) => registration.registeredAt)
    .sort()
    .at(-1);
  checkAcquisition(config.files);
  checkAcquisition(
    config.files.filter((file) => outcomeSourceNames.has(file.name)),
    latestSealTime,
  );
  if (
    config.files.some(
      (file) =>
        outcomeSourceNames.has(file.name) &&
        protocol.inspectedSourceRevisions.includes(file.revision),
    )
  )
    throw new Error("Outcome source revision was already inspected");
  const outcomes = await withSources(
    config.files,
    async (connection, sources) => {
      // Source folding/normalization only: never fit a model using outcome values.
      await sql(connection, "00_sources.sql");
      await sql(connection, "10_observations.sql");
      await prepareObservationContexts(
        connection,
        sources.schedule_class_records,
        sources.schedule_course_records,
      );
      const raw = (
        await connection.runAndReadAll(
          `
      SELECT contexts.observation_id AS "observationId", contexts.term_num AS term,
        CASE WHEN evidence_role = 'instructor' THEN 'instructor' ELSE 'course' END AS family,
        contexts.subject || ' ' || contexts.code AS "courseEntityId",
        CASE WHEN evidence_role <> 'instructor' THEN contexts.subject || ' ' || contexts.code END AS "entityId",
        instructor_name AS "instructorName", contexts.criterion, contexts.source, contexts.rating,
        contexts.source_stddev AS "sourceStddev", source_samples::DOUBLE AS samples,
        source_weight AS weight,
        CASE WHEN scheduled_team_size > 0 THEN scheduled_team_size END AS "teamSize"
      FROM backtest_observation_contexts AS contexts
      LEFT JOIN sfq_instructor_observations AS instructors USING (observation_id)
      WHERE contexts.term_num >= $first
      ORDER BY term, family, "observationId"
    `,
          { first: protocol.firstOutcomeTerm },
        )
      ).getRowObjectsJson() as Array<
        Omit<OutcomeRow, "sourceRevision"> & { instructorName: string | null }
      >;
      return raw.map(({ instructorName, ...row }): OutcomeRow => {
        const latest = seals
          .filter((seal) => seal.metadata.cutoffTerm < row.term)
          .sort((a, b) => b.metadata.cutoffTerm - a.metadata.cutoffTerm)[0];
        const sourceName =
          row.source === "review"
            ? "reviews.parquet"
            : row.family === "course"
              ? "sfq-sections.parquet"
              : "sfq-instructors.parquet";
        const file = config.files.find((file) => file.name === sourceName);
        if (!file) throw new Error(`Missing outcome source ${sourceName}`);
        return {
          ...row,
          sourceRevision: file.revision,
          entityId:
            instructorName === null
              ? row.entityId
              : (latest?.metadata.identities.aliases[
                  instructorName.trim().toLowerCase()
                ] ?? null),
        };
      });
    },
  );
  const seal = await sealBundle<OutcomeMetadata>(
    directory,
    {
      kind: "outcomes",
      protocolSha256,
      forecastSeals: seals.map((seal) => seal.sha256).sort(),
      outcomes,
    },
    config.files,
  );
  await registerSeal(
    registryDirectory(),
    seal.sha256,
    "outcomes",
    protocolSha256,
    seal.sealedAt,
  );
  return seal;
}

export async function evaluateOutcomeSeal(
  protocolPath: string,
  forecastReferences: OutcomeConfig["forecastSeals"],
  outcomeDirectory: string,
  outcomeSha256: string,
) {
  const { protocol, protocolSha256, seals } = await loadForecasts(
    protocolPath,
    forecastReferences,
  );
  const outcomeSeal = await readSeal<OutcomeMetadata>(outcomeDirectory);
  if (outcomeSeal.sha256 !== outcomeSha256)
    throw new Error("Outcome seal hash mismatch");
  await assertRegisteredSeal(
    registryDirectory(),
    outcomeSeal.sha256,
    "outcomes",
    protocolSha256,
    outcomeSeal.sealedAt,
  );
  if (
    outcomeSeal.metadata.kind !== "outcomes" ||
    outcomeSeal.metadata.protocolSha256 !== protocolSha256 ||
    JSON.stringify(outcomeSeal.metadata.forecastSeals) !==
      JSON.stringify(seals.map((seal) => seal.sha256).sort())
  )
    throw new Error(
      "Outcome seal does not match the protocol and forecast set",
    );
  checkAcquisition(
    outcomeSeal.files
      .filter((file) => outcomeSourceNames.has(file.name))
      .map((file) => ({ ...file, path: join(outcomeDirectory, file.name) })),
    seals
      .map((seal) => seal.sealedAt)
      .sort()
      .at(-1),
  );
  // One ledger across this repository's worktrees and copied protocol paths.
  // Failure after reservation intentionally consumes these observations/units.
  const outcomeKeys = [
    ...new Set(
      outcomeSeal.metadata.outcomes.flatMap((row) => [
        `observation:${row.family}:${row.observationId}`,
        `unit:${row.family}:${row.entityId ?? row.observationId}:${row.term}:${row.criterion}`,
      ]),
    ),
  ];
  const claim = await claimEvaluation(
    registryDirectory(),
    outcomeKeys,
    outcomeSeal.sha256,
  );
  try {
    return evaluateProspective(
      protocol,
      seals.flatMap((seal) => seal.metadata.forecasts),
      outcomeSeal.metadata.outcomes,
      Object.fromEntries(
        seals.map((seal) => [
          seal.metadata.cutoffTerm,
          seal.metadata.identities.uuids,
        ]),
      ),
      Object.fromEntries(
        seals.map((seal) => [
          seal.metadata.cutoffTerm,
          seal.metadata.populationCourseIds,
        ]),
      ),
    );
  } finally {
    await claim.release();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, configPath, outputPath] = process.argv.slice(2);
  if (!configPath || !outputPath)
    throw new Error(
      "Usage: prospective.ts protocol|forecast|outcomes|evaluate config.json destination",
    );
  const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
  if (command === "protocol")
    console.log(
      JSON.stringify(await createProtocol(resolve(outputPath), config)),
    );
  else if (command === "forecast" || command === "outcomes") {
    const seal =
      command === "forecast"
        ? await writeForecastSeal(resolve(outputPath), config)
        : await writeOutcomeSeal(resolve(outputPath), config);
    console.log(
      JSON.stringify({ sealedAt: seal.sealedAt, sha256: seal.sha256 }),
    );
  } else if (command === "evaluate") {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    const destination = await open(resolve(outputPath), "wx");
    try {
      const report = await evaluateOutcomeSeal(
        config.protocolPath,
        config.forecastSeals,
        config.outcomeDirectory,
        config.outcomeSha256,
      );
      await destination.writeFile(`${JSON.stringify(report, null, 2)}\n`);
      await destination.sync();
    } finally {
      await destination.close();
    }
  } else throw new Error(`Unknown command: ${command}`);
}
