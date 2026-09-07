// THROWAWAY PROTOTYPE: fit separate Course, Instructor, and Course Offering effects.
// Run: node prototypes/course-instructor-offering.ts D:/Temp/ust-rankings-167-data D:/Temp/ust-rankings-crossed
// Frozen development controls: append --negative-control (requires crossed-rows.parquet).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(process.argv[2] ?? "");
const outputDirectory = resolve(process.argv[3] ?? "");
const negativeControl = process.argv[4] === "--negative-control";
const termLimit = negativeControl ? "AND term_num <= 102" : "";
const sourceRevisions = {
  catalog: "fd704a74bfc9fd9076680da3d80d0a7e304c7164",
  schedule: "8710e83979c989401aab91972234659adbeaba0a",
  reviews: "1069ca3822f00da12a22fee8f7ea4fc87dfe8344",
  sfq: "880e90dbd3af759e1e91c85a1bb721197a79bd8d",
};
if (!process.argv[2] || !process.argv[3])
  throw new Error("Data and output directories are required");
const path = (value: string) =>
  resolve(dataDirectory, value).replaceAll("\\", "/");
function at<T>(values: T[], index: number): T {
  const value = values[index];
  assert(value !== undefined, `Missing observation at index ${index}`);
  return value;
}

const instance = await DuckDBInstance.create(":memory:");
const connection = await instance.connect();
await connection.run("SET threads = 1");
for (const [name, value] of Object.entries({
  catalog_courses: path("catalog/courses.parquet"),
  schedule_classes: path("schedule/classes.parquet"),
  schedule_courses: path("schedule/courses.parquet"),
  reviews: path("ust-space/reviews.parquet"),
  sfq_instructors: path("sfq/canonical/instructor_records.parquet"),
  sfq_sections: path("sfq/canonical/section_records.parquet"),
}))
  await connection.run(`SET VARIABLE ${name} = $value`, { value });
let sourceSql = await readFile(resolve(root, "sql", "00_sources.sql"), "utf8");
if (negativeControl) {
  for (const source of ["sfq_instructors", "sfq_sections"])
    sourceSql = sourceSql.replaceAll(
      `FROM read_parquet(getvariable('${source}'))`,
      `FROM read_parquet(getvariable('${source}')) WHERE term_num <= 102`,
    );
}
await connection.run(sourceSql);
await connection.run(`
  CREATE OR REPLACE MACRO prototype_name_key(value) AS (
    array_to_string(list_sort(list_filter(string_split(
      trim(regexp_replace(
        lower(strip_accents(coalesce(value, ''))), '[^a-z]+', ' ', 'g'
      )),
      ' '
    ), token -> token <> '')), '|')
  );
  CREATE OR REPLACE TEMP TABLE prototype_legacy_ids AS
  SELECT
    term_num,
    upper(trim(prefix)) AS prefix,
    upper(trim(number)) AS number,
    section,
    prototype_name_key(instructor_name) AS name_key,
    first(lower(trim(instructor_itsc)) ORDER BY "timestamp" DESC) AS itsc
  FROM read_parquet([
    '${path("sfq/instructor_records___f_legacy.parquet")}',
    '${path("sfq/instructor_records___f_legacy_1.parquet")}',
    '${path("sfq/instructor_records___f_legacy_2.parquet")}'
  ])
  WHERE status = 'ACTIVE'
    ${termLimit}
    AND instructor_itsc IS NOT NULL
    AND length(trim(instructor_itsc)) > 0
  GROUP BY ALL;

  CREATE OR REPLACE TEMP TABLE prototype_name_ids AS
  SELECT
    name_key,
    min(itsc) AS itsc
  FROM prototype_legacy_ids
  GROUP BY name_key
  HAVING count(DISTINCT itsc) = 1;

  CREATE OR REPLACE TEMP TABLE prototype_classes AS
  WITH ranked AS (
    SELECT
      *,
      row_number() OVER (
        PARTITION BY
          term_num,
          upper(trim(prefix)),
          upper(trim(course_number)),
          coalesce(section, '')
        ORDER BY
          "timestamp" DESC NULLS LAST,
          coalesce(source_order, -1) DESC,
          CASE version WHEN 'api' THEN 0 ELSE 1 END,
          status ASC
      ) AS event_rank
    FROM read_parquet('${path("schedule/canonical/class_records.parquet")}')
    WHERE prefix IS NOT NULL AND course_number IS NOT NULL
      ${termLimit}
  )
  SELECT
    term_num,
    upper(trim(prefix)) AS prefix,
    upper(trim(course_number)) AS number,
    section,
    enroll::DOUBLE AS enrollment,
    capacity::DOUBLE AS capacity,
    len(list_distinct(list_filter(
      flatten(list_transform(schedules, schedule -> schedule.instructors)),
      instructor -> length(trim(coalesce(instructor, ''))) > 0
    )))::INTEGER AS team_size
  FROM ranked
  WHERE event_rank = 1 AND status = 'ACTIVE';
`);

type ModelRow = {
  term: number;
  courseId: string;
  instructorId: string;
  classId: string;
  courseRating: number;
  instructorRating: number;
  respondents: number;
  enrollment: number | null;
  capacity: number | null;
  teamSize: number;
  hasItsc: boolean;
};

const modelSql = `
    WITH mapped AS (
      SELECT
        sfq.term_num::INTEGER AS term,
        upper(trim(sfq.prefix)) || ' ' || upper(trim(sfq.number)) AS course_id,
        concat_ws(
          chr(31), sfq.term_num::VARCHAR, upper(trim(sfq.prefix)),
          upper(trim(sfq.number)), sfq.section
        ) AS class_id,
        coalesce(
          'itsc:' || direct.itsc,
          'itsc:' || names.itsc,
          'name:' || prototype_name_key(sfq.instructor_name)
        ) AS instructor_id,
        sfq.course_overall_mean::DOUBLE AS course_rating,
        sfq.instructor_overall_mean::DOUBLE AS instructor_rating,
        greatest(sfq.num_invites * sfq.response_rate, 1)::DOUBLE AS respondents,
        classes.enrollment,
        classes.capacity,
        greatest(coalesce(classes.team_size, 1), 1)::INTEGER AS team_size,
        coalesce(direct.itsc, names.itsc) IS NOT NULL AS has_itsc
      FROM source_sfq_instructors AS sfq
      LEFT JOIN prototype_legacy_ids AS direct
        ON direct.term_num = sfq.term_num
       AND direct.prefix = upper(trim(sfq.prefix))
       AND direct.number = upper(trim(sfq.number))
       AND direct.section = sfq.section
       AND direct.name_key = prototype_name_key(sfq.instructor_name)
      LEFT JOIN prototype_name_ids AS names
        ON names.name_key = prototype_name_key(sfq.instructor_name)
      LEFT JOIN prototype_classes AS classes
        ON classes.term_num = sfq.term_num
       AND classes.prefix = upper(trim(sfq.prefix))
       AND classes.number = upper(trim(sfq.number))
       AND classes.section = sfq.section
      WHERE sfq.course_overall_mean BETWEEN 1 AND 5
        AND sfq.instructor_overall_mean BETWEEN 1 AND 5
        ${negativeControl ? "AND sfq.term_num <= 102" : ""}
    )
    SELECT
      term,
      course_id,
      instructor_id,
      class_id,
      sum(respondents * course_rating) / sum(respondents) AS course_rating,
      sum(respondents * instructor_rating) / sum(respondents)
        AS instructor_rating,
      sum(respondents) AS respondents,
      max(enrollment) AS enrollment,
      max(capacity) AS capacity,
      max(team_size)::INTEGER AS team_size,
      bool_or(has_itsc) AS has_itsc
    FROM mapped
    GROUP BY term, course_id, instructor_id, class_id
    ORDER BY term, course_id, instructor_id, class_id
  `;
const toModelRow = (row: Record<string, unknown>): ModelRow => ({
  term: Number(row.term),
  courseId: String(row.course_id),
  instructorId: String(row.instructor_id),
  classId: String(row.class_id),
  courseRating: Number(row.course_rating),
  instructorRating: Number(row.instructor_rating),
  respondents: Number(row.respondents),
  enrollment: row.enrollment === null ? null : Number(row.enrollment),
  capacity: row.capacity === null ? null : Number(row.capacity),
  teamSize: Number(row.team_size),
  hasItsc: Boolean(row.has_itsc),
});
const rows = (await connection.runAndReadAll(modelSql))
  .getRowObjectsJS()
  .map(toModelRow);

// The cache contains pre-aggregation duplicates and omits respondents. Recover
// original weighted units from pinned sources, and require the same cache units.
let cacheEvidence: Record<string, string | number> | undefined;
let sourceSplitRows: ModelRow[] | undefined;
let sourceSplitMaximumDifference = 0;
if (negativeControl) {
  const splitSql = modelSql.replace(
    "FROM mapped\n",
    "FROM (SELECT * REPLACE (respondents / 2 AS respondents) FROM mapped CROSS JOIN range(2))\n",
  );
  assert(
    splitSql !== modelSql,
    "Source-fragment control must split mapped rows",
  );
  sourceSplitRows = (await connection.runAndReadAll(splitSql))
    .getRowObjectsJS()
    .map(toModelRow);
  assert.equal(sourceSplitRows.length, rows.length);
  sourceSplitRows.forEach((row, index) => {
    const original = at(rows, index);
    for (const field of Object.keys(row) as (keyof ModelRow)[]) {
      const actual = row[field];
      const expected = original[field];
      if (typeof actual === "number" && typeof expected === "number") {
        sourceSplitMaximumDifference = Math.max(
          sourceSplitMaximumDifference,
          Math.abs(actual - expected),
        );
        assert(
          Math.abs(actual - expected) <= 1e-12,
          `${field} changed after fragment aggregation`,
        );
      } else assert.equal(actual, expected);
    }
  });
  const cached = (
    await connection.runAndReadAll(`
      SELECT term_num, course_id, instructor_id, section
      FROM read_parquet('${path("crossed-rows.parquet")}')
      WHERE term_num <= 102
    `)
  ).getRowObjectsJS();
  const cachedKeys = new Set(
    cached.map((row) =>
      [
        row.term_num,
        ...String(row.course_id).split(" "),
        row.section,
        row.instructor_id ?? "name:",
      ].join("\u001f"),
    ),
  );
  const modelKeys = new Set(
    rows.map((row) => `${row.classId}\u001f${row.instructorId}`),
  );
  assert(
    [...cachedKeys]
      .filter((key) => !modelKeys.has(key))
      .every((key) => key.startsWith("102\u001f")),
    "Unexpected cache identity change outside Term 102",
  );
  const classCounts = (keys: Set<string>) =>
    new Map(
      [
        ...Map.groupBy([...keys], (key) =>
          key.slice(0, key.lastIndexOf("\u001f")),
        ),
      ].map(([key, values]) => [key, values.length]),
    );
  const cachedClasses = classCounts(cachedKeys);
  const modelClasses = classCounts(modelKeys);
  if (
    cachedClasses.size !== modelClasses.size ||
    [...cachedClasses].some(([key, count]) => modelClasses.get(key) !== count)
  )
    throw new Error(
      "Pinned model Instructor counts per Class do not match the development cache",
    );
  cacheEvidence = {
    file: "crossed-rows.parquet",
    sha256: createHash("sha256")
      .update(await readFile(path("crossed-rows.parquet")))
      .digest("hex"),
    rawDevelopmentRows: cached.length,
    distinctDevelopmentUnits: cachedKeys.size,
    reconstructedWeightedUnits: rows.length,
    classes: modelClasses.size,
    changedIdentityLabels: [...cachedKeys].filter((key) => !modelKeys.has(key))
      .length,
    identityDifference:
      "The earlier cache retains name fallbacks in Term 102; the original model resolves unique names using historical ITSCs. Cache null identity is normalized to the original model's name: label for this count.",
  };
}

connection.closeSync();
instance.closeSync();

type Aggregate = { sum: number; count: number };
const add = (map: Map<string, Aggregate>, key: string, value: number) => {
  const aggregate = map.get(key) ?? { sum: 0, count: 0 };
  aggregate.sum += value;
  aggregate.count++;
  map.set(key, aggregate);
};
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const shrunk = (
  aggregate: Aggregate | undefined,
  prior: number,
  strength: number,
) =>
  aggregate
    ? (aggregate.sum + strength * prior) / (aggregate.count + strength)
    : prior;
const clamp = (value: number) => Math.max(1, Math.min(5, value));

const classRows = [...Map.groupBy(rows, (row) => row.classId).values()].map(
  (group) => ({
    term: group[0]?.term ?? 0,
    courseId: group[0]?.courseId ?? "",
    classId: group[0]?.classId ?? "",
    courseRating: mean(group.map((row) => row.courseRating)),
    enrollment: group[0]?.enrollment ?? null,
    capacity: group[0]?.capacity ?? null,
    teamSize: Math.max(...group.map((row) => row.teamSize)),
  }),
);
const contextCounts = new Map<number, number>();
for (const row of classRows)
  if (row.enrollment !== null)
    contextCounts.set(row.term, (contextCounts.get(row.term) ?? 0) + 1);
const evaluationTerms = [...contextCounts]
  .filter(([, count]) => count >= 50)
  .map(([term]) => term)
  .sort((left, right) => left - right)
  .slice(1);
const holdoutTerms = evaluationTerms.slice(-2);
const developmentTerms = evaluationTerms.slice(0, -2);

function contextCoefficients(training: typeof classRows) {
  const byCourse = Map.groupBy(training, (row) => row.courseId);
  const centered = training.flatMap((row) => {
    const course = byCourse.get(row.courseId) ?? [];
    const context = course.filter((item) => item.enrollment !== null);
    if (row.enrollment === null || context.length < 2) return [];
    return [
      {
        y: row.courseRating - mean(course.map((item) => item.courseRating)),
        enrollment:
          Math.log1p(row.enrollment) -
          mean(context.map((item) => Math.log1p(item.enrollment ?? 0))),
        team:
          Number(row.teamSize > 1) -
          mean(context.map((item) => Number(item.teamSize > 1))),
      },
    ];
  });
  const xx = centered.reduce(
    (sum, row) => sum + row.enrollment * row.enrollment,
    1,
  );
  const zz = centered.reduce((sum, row) => sum + row.team * row.team, 1);
  const xz = centered.reduce((sum, row) => sum + row.enrollment * row.team, 0);
  const xy = centered.reduce((sum, row) => sum + row.enrollment * row.y, 0);
  const zy = centered.reduce((sum, row) => sum + row.team * row.y, 0);
  const determinant = xx * zz - xz * xz;
  return {
    enrollment: (xy * zz - zy * xz) / determinant,
    team: (zy * xx - xy * xz) / determinant,
    rows: centered.length,
  };
}

type Configuration = {
  courseStrength: number;
  instructorStrength: number;
  interactionStrength: number;
};
type Prediction = {
  term: number;
  courseId: string;
  instructorId: string;
  team: boolean;
  courseOutcome: number;
  instructorOutcome: number;
  courseOnly: number;
  courseContext: number;
  populationResidual: number;
  populationContext: number;
  rawInstructor: number;
  residual: number;
  crossed: number;
};

function predictionsFor(
  configuration: Configuration,
  outcomeTerms: number[],
  modelRows: ModelRow[] = rows,
): Prediction[] {
  const predictions: Prediction[] = [];
  for (const outcomeTerm of outcomeTerms) {
    const training = modelRows.filter((row) => row.term < outcomeTerm);
    const outcomes = modelRows.filter((row) => row.term === outcomeTerm);
    const trainingClasses = classRows.filter((row) => row.term < outcomeTerm);
    if (!training.length || !outcomes.length) continue;
    const globalCourse = mean(trainingClasses.map((row) => row.courseRating));
    const globalInstructor = mean(training.map((row) => row.instructorRating));
    const populationEffect = mean(
      training.map((row) => row.instructorRating - row.courseRating),
    );
    const globalEnrollment = mean(
      trainingClasses
        .filter((row) => row.enrollment !== null)
        .map((row) => Math.log1p(row.enrollment ?? 0)),
    );
    const globalTeam = mean(
      trainingClasses.map((row) => Number(row.teamSize > 1)),
    );
    const courses = new Map<string, Aggregate>();
    const instructors = new Map<string, Aggregate>();
    const instructorRatings = new Map<string, Aggregate>();
    const interactions = new Map<string, Aggregate>();
    const enrollment = new Map<string, Aggregate>();
    const team = new Map<string, Aggregate>();
    for (const row of trainingClasses) {
      add(courses, row.courseId, row.courseRating);
      if (row.enrollment !== null)
        add(enrollment, row.courseId, Math.log1p(row.enrollment));
      add(team, row.courseId, Number(row.teamSize > 1));
    }
    for (const row of training) {
      const residual = row.instructorRating - row.courseRating;
      add(instructors, row.instructorId, residual);
      add(instructorRatings, row.instructorId, row.instructorRating);
      add(interactions, `${row.courseId}\u001f${row.instructorId}`, residual);
    }
    const coefficients = contextCoefficients(trainingClasses);
    for (const outcome of outcomes) {
      const courseBase = shrunk(
        courses.get(outcome.courseId),
        globalCourse,
        configuration.courseStrength,
      );
      const expectedEnrollment = shrunk(
        enrollment.get(outcome.courseId),
        globalEnrollment,
        configuration.courseStrength,
      );
      const expectedTeam = shrunk(
        team.get(outcome.courseId),
        globalTeam,
        configuration.courseStrength,
      );
      const courseContext = clamp(
        courseBase +
          (outcome.enrollment === null
            ? 0
            : coefficients.enrollment *
              (Math.log1p(outcome.enrollment) - expectedEnrollment)) +
          coefficients.team * (Number(outcome.teamSize > 1) - expectedTeam),
      );
      const instructorEffect = shrunk(
        instructors.get(outcome.instructorId),
        0,
        configuration.instructorStrength,
      );
      const interactionHistory = interactions.get(
        `${outcome.courseId}\u001f${outcome.instructorId}`,
      );
      const interaction = interactionHistory
        ? (interactionHistory.sum -
            interactionHistory.count * instructorEffect) /
          (interactionHistory.count + configuration.interactionStrength)
        : 0;
      predictions.push({
        term: outcome.term,
        courseId: outcome.courseId,
        instructorId: outcome.instructorId,
        team: outcome.teamSize > 1,
        courseOutcome: outcome.courseRating,
        instructorOutcome: outcome.instructorRating,
        courseOnly: courseBase,
        courseContext,
        populationResidual: clamp(courseBase + populationEffect),
        populationContext: clamp(courseContext + populationEffect),
        rawInstructor: shrunk(
          instructorRatings.get(outcome.instructorId),
          globalInstructor,
          configuration.instructorStrength,
        ),
        residual: clamp(courseBase + instructorEffect),
        crossed: clamp(courseContext + instructorEffect + interaction),
      });
    }
  }
  return predictions;
}

const entityBalancedError = (
  predictions: Prediction[],
  entity: "courseId" | "instructorId",
  prediction: keyof Pick<
    Prediction,
    | "courseOnly"
    | "courseContext"
    | "populationResidual"
    | "populationContext"
    | "rawInstructor"
    | "residual"
    | "crossed"
  >,
  outcome: "courseOutcome" | "instructorOutcome",
) =>
  mean(
    [...Map.groupBy(predictions, (row) => row[entity]).values()].map((group) =>
      mean(group.map((row) => Math.abs(row[prediction] - row[outcome]))),
    ),
  );

if (negativeControl) {
  // Freeze the original choice and folds. Both historical fold groups are now
  // development data; none of these outcomes is confirmation or a tuning set.
  const configuration = {
    courseStrength: 1,
    instructorStrength: 1,
    interactionStrength: 4,
  };
  const folds = {
    originalDevelopment: [94, 95, 96, 98],
    oldPostHoc: [99, 102],
  };
  const terms = Object.values(folds).flat();
  const original = predictionsFor(configuration, terms);
  const originalDevelopmentError = entityBalancedError(
    original.filter((row) => folds.originalDevelopment.includes(row.term)),
    "instructorId",
    "crossed",
    "instructorOutcome",
  );
  if (Math.abs(originalDevelopmentError - 0.32942133039949745) > 1e-12)
    throw new Error(
      `Original development result changed: ${originalDevelopmentError}`,
    );
  const metrics = (predictions: Prediction[]) =>
    Object.fromEntries(
      Object.entries(folds).map(([name, foldTerms]) => {
        const fold = predictions.filter((row) => foldTerms.includes(row.term));
        const error = (
          model:
            | "courseOnly"
            | "courseContext"
            | "populationResidual"
            | "populationContext"
            | "residual"
            | "crossed",
        ) =>
          entityBalancedError(fold, "instructorId", model, "instructorOutcome");
        return [
          name,
          {
            rows: fold.length,
            instructors: new Set(fold.map((row) => row.instructorId)).size,
            courseOnly: error("courseOnly"),
            courseContext: error("courseContext"),
            populationResidual: error("populationResidual"),
            populationContext: error("populationContext"),
            residual: error("residual"),
            crossed: error("crossed"),
            residualGain: error("courseOnly") - error("residual"),
            crossedGain: error("courseContext") - error("crossed"),
            residualGainOverPopulation:
              error("populationResidual") - error("residual"),
            crossedGainOverPopulation:
              error("populationContext") - error("crossed"),
          },
        ];
      }),
    );
  const shuffled = Array.from({ length: 10 }, (_, index) => {
    const seed = 167 + index;
    let state = seed;
    const shuffledIds = rows.map((row) => row.instructorId);
    for (const indices of Map.groupBy(
      rows.map((_, i) => i),
      (i) => at(rows, i).term,
    ).values()) {
      const labels = indices.map((i) => at(rows, i).instructorId);
      for (let i = labels.length - 1; i > 0; i--) {
        state = (1664525 * state + 1013904223) >>> 0;
        const j = Math.floor((state / 2 ** 32) * (i + 1));
        [labels[i], labels[j]] = [at(labels, j), at(labels, i)];
      }
      indices.forEach((rowIndex, i) => {
        shuffledIds[rowIndex] = at(labels, i);
      });
    }
    const predictions = predictionsFor(
      configuration,
      terms,
      rows.map((row, i) => ({
        ...row,
        instructorId: at(shuffledIds, i),
      })),
    );
    // Keep evaluation groups tied to the actual Instructor, preserving the
    // exact entity-balanced metric weights in the unshuffled experiment.
    predictions.forEach((row, i) => {
      row.instructorId = at(original, i).instructorId;
    });
    if (
      predictions.some(
        (row, i) =>
          row.courseOnly !== at(original, i).courseOnly ||
          row.courseContext !== at(original, i).courseContext ||
          row.populationResidual !== at(original, i).populationResidual ||
          row.populationContext !== at(original, i).populationContext ||
          row.instructorOutcome !== at(original, i).instructorOutcome,
      )
    )
      throw new Error("Shuffle changed an outcome or Course baseline");
    return {
      seed,
      reassignedFraction: mean(
        shuffledIds.map((id, i) => Number(id !== at(rows, i).instructorId)),
      ),
      metrics: metrics(predictions),
    };
  });
  // A half-respondent split after the SQL aggregation boundary is deliberately
  // adversarial: the prototype's fitter currently counts records, not weight.
  // Split training only, retaining identical outcomes and evaluation weights.
  const splitPredictions = terms.flatMap((term) =>
    predictionsFor(
      configuration,
      [term],
      rows.flatMap((row) =>
        row.term < term && row.teamSize > 1
          ? [
              { ...row, respondents: row.respondents / 2 },
              { ...row, respondents: row.respondents / 2 },
            ]
          : [row],
      ),
    ),
  );
  const difference = (
    field: "courseOnly" | "courseContext" | "residual" | "crossed",
  ) => {
    const deltas = splitPredictions.map((row, i) =>
      Math.abs(row[field] - at(original, i)[field]),
    );
    return {
      changedPredictions: deltas.filter((value) => value > 1e-12).length,
      maximumAbsoluteChange: Math.max(...deltas),
      meanAbsoluteChange: mean(deltas),
    };
  };
  const report = {
    prototype: true,
    negativeControl: true,
    developmentOnly: true,
    productionPromotion: false,
    maximumTerm: 102,
    sourceRevisions,
    configuration,
    folds,
    cache: cacheEvidence,
    method:
      "Fisher-Yates Instructor-label permutation within each Term, LCG seeds 167..176; original Instructor evaluation groups, outcome rows, Class context, fitting rules, and fixed configuration retained.",
    original: metrics(original),
    shuffled,
    sourceFragmentSplit: {
      method:
        "Each mapped SFQ observation becomes two identical half-respondent fragments before the original SQL aggregation. Every canonical field is checked within 1e-12 (exact comparison for nonnumeric fields).",
      canonicalRows: sourceSplitRows?.length,
      canonicalRowsUnchangedWithinTolerance: true,
      maximumCanonicalNumericDifference: sourceSplitMaximumDifference,
      metrics: metrics(predictionsFor(configuration, terms, sourceSplitRows)),
    },
    equivalentTeamRowSplit: {
      boundary:
        "Post-aggregation training model rows only; split every team row into two equal-rating half-respondent rows. Course Class rows and evaluation rows are unchanged.",
      courseOnly: difference("courseOnly"),
      courseContext: difference("courseContext"),
      residual: difference("residual"),
      crossed: difference("crossed"),
      metrics: metrics(splitPredictions),
      limitation:
        "The fitter accepts canonical Instructor-Class rows, so duplicate rows here violate its input contract and this is not a confirmed pipeline defect. The downstream fitter ignores respondents and relies on upstream aggregation to enforce the invariant.",
    },
    limits: [
      "All evaluated Terms were previously inspected and are development only; this is not independent confirmation.",
      "An identity permutation does not remove the population mean Instructor-minus-Course rating offset. Compare real gains to shuffled gains; do not interpret a nonzero residual gain alone as surviving identity signal.",
      "The cached file omits respondents and has duplicate units; values are reconstructed with the original pinned source aggregation and cross-checked against distinct cache units.",
      "No model selection, source refresh, production change, or scoring of outcomes above Term 102 occurs.",
    ],
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "crossed-negative-control.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const configurations = [1, 4, 16].flatMap((courseStrength) =>
  [1, 4, 16].flatMap((instructorStrength) =>
    [4, 16, 64].map((interactionStrength) => ({
      courseStrength,
      instructorStrength,
      interactionStrength,
    })),
  ),
);
const development = configurations.map((configuration) => {
  const predictions = predictionsFor(configuration, developmentTerms);
  return {
    configuration,
    error: entityBalancedError(
      predictions,
      "instructorId",
      "crossed",
      "instructorOutcome",
    ),
  };
});
const selected = development.toSorted(
  (left, right) => left.error - right.error,
)[0];
if (!selected) throw new Error("No prototype configuration was evaluated");
const holdout = predictionsFor(selected.configuration, holdoutTerms);

function interval(
  predictions: Prediction[],
  entity: "courseId" | "instructorId",
  candidate: "courseContext" | "residual" | "crossed",
  baseline: "courseOnly" | "rawInstructor",
  outcome: "courseOutcome" | "instructorOutcome",
) {
  const clusters = [
    ...Map.groupBy(predictions, (row) => row[entity]).values(),
  ].map((group) =>
    mean(
      group.map(
        (row) =>
          Math.abs(row[candidate] - row[outcome]) -
          Math.abs(row[baseline] - row[outcome]),
      ),
    ),
  );
  let state = 167;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const estimates = Array.from({ length: 5000 }, () =>
    mean(
      Array.from(
        { length: clusters.length },
        () => clusters[Math.floor(random() * clusters.length)] ?? 0,
      ),
    ),
  ).sort((left, right) => left - right);
  return {
    estimate: mean(clusters),
    lower95: estimates[125],
    upper95: estimates[4874],
    probabilityOfImprovement:
      estimates.filter((value) => value < 0).length / estimates.length,
    clusters: clusters.length,
  };
}

const teamRows = holdout.filter((row) => row.team);
const soloRows = holdout.filter((row) => !row.team);
const context = contextCoefficients(
  classRows.filter((row) => row.term < Math.min(...holdoutTerms)),
);
const report = {
  prototype: true,
  question:
    "Can separate, shrunk Course, Instructor, and Course Offering effects reduce context misattribution?",
  sourceRevisions,
  data: {
    rows: rows.length,
    terms: [...new Set(rows.map((row) => row.term))].sort(
      (left, right) => left - right,
    ),
    contextTerms: [...contextCounts.keys()].sort((left, right) => left - right),
    rowsWithContext: rows.filter((row) => row.enrollment !== null).length,
    rowsWithItsc: rows.filter((row) => row.hasItsc).length,
    teamRows: rows.filter((row) => row.teamSize > 1).length,
    maximumTeamAllocationError: Math.max(
      ...rows.map((row) => Math.abs(row.teamSize * (1 / row.teamSize) - 1)),
    ),
  },
  validation: {
    developmentTerms,
    holdoutTerms,
    postHoc: true,
    selected: selected.configuration,
    developmentError: selected.error,
    holdoutRows: holdout.length,
  },
  contextCoefficients: context,
  holdout: {
    course: {
      courseOnly: entityBalancedError(
        holdout,
        "courseId",
        "courseOnly",
        "courseOutcome",
      ),
      withOfferingContext: entityBalancedError(
        holdout,
        "courseId",
        "courseContext",
        "courseOutcome",
      ),
      interval: interval(
        holdout,
        "courseId",
        "courseContext",
        "courseOnly",
        "courseOutcome",
      ),
    },
    instructor: {
      rawHistory: entityBalancedError(
        holdout,
        "instructorId",
        "rawInstructor",
        "instructorOutcome",
      ),
      courseOnly: entityBalancedError(
        holdout,
        "instructorId",
        "courseOnly",
        "instructorOutcome",
      ),
      coursePlusInstructor: entityBalancedError(
        holdout,
        "instructorId",
        "residual",
        "instructorOutcome",
      ),
      crossed: entityBalancedError(
        holdout,
        "instructorId",
        "crossed",
        "instructorOutcome",
      ),
      crossedVersusRawInterval: interval(
        holdout,
        "instructorId",
        "crossed",
        "rawInstructor",
        "instructorOutcome",
      ),
      teamTaughtCrossedError: entityBalancedError(
        teamRows,
        "instructorId",
        "crossed",
        "instructorOutcome",
      ),
      soloCrossedError: entityBalancedError(
        soloRows,
        "instructorId",
        "crossed",
        "instructorOutcome",
      ),
    },
  },
  limits: [
    "The holdout is post hoc and is not independent confirmation.",
    "The prototype uses historical ITSCs when available and a unique normalized name fallback otherwise.",
    "Schedule context begins at Term 92. Earlier SFQ rows have no Class context.",
    "Enrollment and team teaching are predictive context, not causal quality effects.",
    "The model does not change production Rankings.",
  ],
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  join(outputDirectory, "crossed-model.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
const escapedReport = JSON.stringify(report).replaceAll("<", "\\u003c");
await writeFile(
  join(outputDirectory, "crossed-model-demo.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Course, Instructor, and Course Offering prototype</title>
<style>
:root{font:16px/1.5 system-ui,sans-serif;color:#17202a;background:#f5f7f9}body{max-width:960px;margin:auto;padding:32px}h1{line-height:1.1}.panel{background:white;border:1px solid #dfe5eb;border-radius:12px;padding:20px;margin:18px 0}button{font:inherit;padding:9px 14px;margin:4px;border:1px solid #147d73;border-radius:8px;background:white;color:#0b5f57;cursor:pointer}button[aria-pressed=true]{background:#147d73;color:white}.metric{display:grid;grid-template-columns:2fr 1fr;gap:8px;border-bottom:1px solid #edf0f2;padding:8px 0}.value{font-variant-numeric:tabular-nums;font-weight:700}.note{color:#53606c}code{background:#edf4f3;padding:2px 5px;border-radius:4px}</style></head>
<body><h1>Separate effect prototype</h1><p>This throwaway demo asks whether Course, Instructor, and Course Offering effects can be separated without multiplying team evidence.</p>
<section class="panel"><h2>Guided views</h2><div id="actions"></div></section>
<section class="panel"><h2 id="title"></h2><p id="description" class="note"></p><div id="metrics"></div></section>
<section class="panel"><h2>Current state</h2><div id="state"></div></section>
<script>
const report=${escapedReport};
const scenarios={
 course:{title:'Course Offering context',description:'Compare a stable Course effect with enrollment and team context.',metrics:{'Course-only error':report.holdout.course.courseOnly,'With Offering context':report.holdout.course.withOfferingContext,'Interval lower':report.holdout.course.interval.lower95,'Interval upper':report.holdout.course.interval.upper95}},
 instructor:{title:'Instructor effect',description:'Compare raw Instructor history with a residual after Course context is removed.',metrics:{'Raw history error':report.holdout.instructor.rawHistory,'Course plus Instructor':report.holdout.instructor.coursePlusInstructor,'Crossed model':report.holdout.instructor.crossed,'Interval lower':report.holdout.instructor.crossedVersusRawInterval.lower95,'Interval upper':report.holdout.instructor.crossedVersusRawInterval.upper95}},
 team:{title:'Team teaching',description:'The model splits one shared evidence weight across the teaching team.',metrics:{'Team allocation error':report.data.maximumTeamAllocationError,'Team-taught error':report.holdout.instructor.teamTaughtCrossedError,'Solo error':report.holdout.instructor.soloCrossedError,'Team rows':report.data.teamRows}},
 validation:{title:'Validation limits',description:'These results use a post-hoc holdout. They cannot authorize a production change.',metrics:{'Development Terms':report.validation.developmentTerms.join(', '),'Holdout Terms':report.validation.holdoutTerms.join(', '),'Holdout rows':report.validation.holdoutRows,'Rows with ITSC':report.data.rowsWithItsc}}
};
function reduce(state,action){return scenarios[action]?{...state,scenario:action}:state}
let state={scenario:'course'};
function render(){const scenario=scenarios[state.scenario];document.querySelector('#title').textContent=scenario.title;document.querySelector('#description').textContent=scenario.description;document.querySelector('#metrics').innerHTML=Object.entries(scenario.metrics).map(([key,value])=>\`<div class="metric"><span>\${key}</span><span class="value">\${typeof value==='number'?value.toFixed(4):value}</span></div>\`).join('');document.querySelector('#state').innerHTML=\`<div class="metric"><span>Selected view</span><span class="value">\${state.scenario}</span></div><div class="metric"><span>Course shrinkage</span><span class="value">\${report.validation.selected.courseStrength}</span></div><div class="metric"><span>Instructor shrinkage</span><span class="value">\${report.validation.selected.instructorStrength}</span></div><div class="metric"><span>Interaction shrinkage</span><span class="value">\${report.validation.selected.interactionStrength}</span></div>\`;document.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.action===state.scenario)))}
document.querySelector('#actions').innerHTML=Object.entries(scenarios).map(([key,value])=>\`<button data-action="\${key}">\${value.title}</button>\`).join('');document.querySelector('#actions').addEventListener('click',event=>{const action=event.target.dataset.action;if(action){state=reduce(state,action);render()}});render();
</script></body></html>`,
);
console.log(`Wrote ${join(outputDirectory, "crossed-model.json")}`);
console.log(`Wrote ${join(outputDirectory, "crossed-model-demo.html")}`);
