import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { writeArchiveFixture } from "./archive-fixture.ts";

export const fixtureSha = "0123456789abcdef0123456789abcdef01234567";

const identities = [
  {
    uuid: "00000000-0000-4000-8000-000000000001",
    canonicalName: "Alpha Instructor",
    aliases: [
      {
        name: "Alpha Instructor",
        source: "schedule",
        sourceCommit: fixtureSha,
      },
    ],
  },
  {
    uuid: "00000000-0000-4000-8000-000000000002",
    canonicalName: "Beta Instructor",
    itsc: "beta",
    aliases: [
      { name: "Second Teacher", source: "sfq", sourceCommit: fixtureSha },
    ],
  },
  {
    uuid: "00000000-0000-4000-8000-000000000003",
    canonicalName: "Delta Instructor",
    aliases: [
      { name: "Delta Instructor", source: "review", sourceCommit: fixtureSha },
    ],
  },
  {
    uuid: "00000000-0000-4000-8000-000000000004",
    canonicalName: "Gamma Instructor",
    aliases: [
      {
        name: "Gamma Instructor",
        source: "schedule",
        sourceCommit: fixtureSha,
      },
    ],
  },
  {
    uuid: "00000000-0000-4000-8000-000000000005",
    canonicalName: "Historical Instructor",
    aliases: [
      {
        name: "Former Teacher",
        source: "schedule",
        sourceCommit: fixtureSha,
      },
    ],
  },
];

const ratingColumns = `
  term_num, term_code, is_active, criterion, rating, bayesian, confidence,
  samples, cumulative_samples, effective_samples, reliability, posterior_stddev
`;
const castMeasures = `* REPLACE (
  rating::DOUBLE AS rating, bayesian::DOUBLE AS bayesian,
  confidence::DOUBLE AS confidence, effective_samples::DOUBLE AS effective_samples,
  reliability::DOUBLE AS reliability, posterior_stddev::DOUBLE AS posterior_stddev
)`;

async function hash(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function makeRankingArchiveFixture(
  directory: string,
  sourceCommit: string,
  eventSourceCommit: string,
  correctionSourceCommit: string,
) {
  const inputs = [
    "courses.parquet",
    "course-ratings.parquet",
    "instructor-ratings.parquet",
    "course-instructors.parquet",
    "instructor-identities.parquet",
    "instructor-aliases.parquet",
    "instructor-identity-events.parquet",
    "instructor-split-affected-associations.parquet",
  ];
  const alphaUuid = "00000000-0000-4000-8000-000000000001";
  const betaUuid = "00000000-0000-4000-8000-000000000002";
  return writeArchiveFixture(
    directory,
    sourceCommit,
    inputs,
    async ({ copy }) => {
      await copy(
        "courses.parquet",
        `SELECT * FROM (VALUES
        ('CAT', '5000', 'Catalog Only', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[]),
        ('COMP', '1000', 'Computing One', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[]),
        ('COMP', '2000', 'Computing Two', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[])
      ) AS t(prefix, number, title, attributes)`,
      );
      const ratingColumns = `
      term_num, term_code, is_offered, criterion, rating, bayesian,
      confidence, samples, cumulative_samples, effective_samples,
      reliability, posterior_stddev`;
      await copy(
        "course-ratings.parquet",
        `SELECT * FROM (VALUES
        ('COMP', '1000', 100, '2510', true, 'content', 4.0, 4.0, 1.0, 2::BIGINT, 2::BIGINT, 2.0, 0.8, 0.1),
        ('COMP', '2000', 100, '2510', true, 'content', 3.0, 3.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.7, 0.2),
        ('HIST', '3000', 99, '2430', false, 'content', 2.0, 2.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.6, 0.3)
      ) AS t(subject, code, ${ratingColumns})`,
      );
      await copy(
        "instructor-ratings.parquet",
        `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alpha Instructor', 100, '2510', true, 'instructor', 4.0, 4.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.8, 0.1),
        ('${betaUuid}', 'Beta Instructor', 100, '2510', true, 'instructor', 3.0, 3.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.7, 0.2)
      ) AS t(uuid, name, term_num, term_code, is_teaching, criterion, rating, bayesian,
        confidence, samples, cumulative_samples, effective_samples, reliability, posterior_stddev)`,
      );
      await copy(
        "course-instructors.parquet",
        `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alpha Instructor', 100, '2510', 'COMP', '1000'),
        ('${betaUuid}', 'Beta Instructor', 100, '2510', 'COMP', '1000'),
        ('${betaUuid}', 'Beta Instructor', 100, '2510', 'COMP', '2000')
      ) AS t(uuid, name, term_num, term_code, subject, code)`,
      );
      await copy(
        "instructor-identities.parquet",
        `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alpha Instructor', NULL::VARCHAR),
        ('${betaUuid}', 'Beta Instructor', 'beta'::VARCHAR)
      ) AS t(uuid, canonical_name, itsc)`,
      );
      await copy(
        "instructor-aliases.parquet",
        `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alias Alpha', 'schedule', '${eventSourceCommit}', NULL::VARCHAR),
        ('${betaUuid}', 'Beta Instructor', 'schedule', '${eventSourceCommit}', NULL::VARCHAR)
      ) AS t(uuid, name, source, source_commit, source_file)`,
      );
      await copy(
        "instructor-identity-events.parquet",
        `SELECT * FROM (VALUES
        ('merge', '${eventSourceCommit}', NULL::VARCHAR, NULL::VARCHAR,
          '${alphaUuid}', '${betaUuid}', NULL::VARCHAR, NULL::VARCHAR)
      ) AS t(event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid)`,
      );
      await copy(
        "instructor-split-affected-associations.parquet",
        `SELECT * FROM (VALUES
        ('calibration', '${correctionSourceCommit}', '${betaUuid}', 'Calibrated Name', '2510', 'COMP 2000')
      ) AS t(correction_type, source_commit, target_uuid, source_name, term_code, course_code)`,
      );
    },
  );
}

type Malformation =
  | "invalid-schema"
  | "duplicate-grain"
  | "non-finite"
  | "null-samples"
  | "wrong-latest-term"
  | "failed-smoke-query"
  | "tba-alias"
  | "ambiguous-canonical-name"
  | "legacy-name-keyed"
  | "missing-course-dimension"
  | "malformed-course-dimension"
  | "invalid-course-dimension"
  | "duplicate-course-dimension";

export type FixtureIdentityEvent =
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

export async function makeRankingGeneration(
  root: string,
  malformation?: Malformation,
  options: {
    extraCourses?: number;
    extraInstructors?: number;
    includeScheduleCourse?: boolean;
    includePriorOnly?: boolean;
    identityEvents?: FixtureIdentityEvent[];
    associationCorrections?: Array<{
      correctionType: "split" | "calibration";
      sourceCommit: string;
      targetUuid: string;
      sourceName: string;
      termCode?: string;
      courseCode: string;
    }>;
    sameNameAssociations?: boolean;
    sameNameSplit?: boolean;
    firstCourseTitle?: string;
  } = {},
) {
  const directory = join(root, fixtureSha);
  await mkdir(directory, { recursive: true });
  const fixtureIdentities = structuredClone(identities);
  if (
    (malformation === "ambiguous-canonical-name" ||
      options.sameNameAssociations ||
      options.sameNameSplit) &&
    fixtureIdentities[1]
  ) {
    fixtureIdentities[1].canonicalName =
      fixtureIdentities[0]?.canonicalName ?? "";
    if (
      malformation === "ambiguous-canonical-name" ||
      options.sameNameAssociations
    )
      fixtureIdentities[1].aliases = structuredClone(
        fixtureIdentities[0]?.aliases ?? [],
      );
  }
  if (options.includePriorOnly) {
    fixtureIdentities.push({
      uuid: "00000000-0000-4000-8000-000000000006",
      canonicalName: "Prior Instructor",
      aliases: [
        {
          name: "Prior Instructor",
          source: "schedule",
          sourceCommit: fixtureSha,
        },
      ],
    });
  }
  for (let index = 0; index < (options.extraInstructors ?? 0); index += 1) {
    const suffix = String(index + 1).padStart(12, "0");
    fixtureIdentities.push({
      uuid: `10000000-0000-4000-8000-${suffix}`,
      canonicalName: `Bulk Instructor ${String(index + 1).padStart(3, "0")}`,
      aliases: [
        {
          name: `Bulk Instructor ${String(index + 1).padStart(3, "0")}`,
          source: "schedule",
          sourceCommit: fixtureSha,
        },
      ],
    });
  }
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const file = (name: string) => join(directory, name).replaceAll("\\", "/");
  const copy = async (name: string, query: string) => {
    await connection.run("SET VARIABLE output_path = $path", {
      path: file(name),
    });
    await connection.run(
      `COPY (${query}) TO (getvariable('output_path')) (FORMAT parquet)`,
    );
  };

  try {
    const courseRows: string[] = [];
    const fixtureCourses: Array<readonly [string, string, boolean, string]> = [
      ["COMP", "1000", true, ""],
      ["COMP", "1029C", true, ""],
      ["MATH", "2000", true, ""],
      ["HIST", "3000", false, ""],
      ["MISS", "4000", true, "instructor"],
    ];
    if (options.includeScheduleCourse)
      fixtureCourses.push(["COMP", "2000", true, ""]);
    if (options.includePriorOnly)
      fixtureCourses.push(["OFFR", "5000", true, ""]);
    for (let index = 0; index < (options.extraCourses ?? 0); index += 1)
      fixtureCourses.push(["BULK", String(1000 + index), true, ""]);
    for (const [
      prefix,
      courseNumber,
      isOffered,
      missingCriterion,
    ] of fixtureCourses) {
      for (const criterion of [
        "content",
        "teaching",
        "grading",
        "workload",
        "course",
        "instructor",
      ]) {
        if (criterion === missingCriterion) continue;
        const priorOnly = prefix === "OFFR";
        const cumulativeSamples = priorOnly
          ? 0
          : criterion === "content"
            ? 11
            : criterion === "course"
              ? 22
              : 33;
        const score = priorOnly
          ? 0.75
          : prefix === "COMP" && courseNumber === "1000"
            ? Number(criterion === "content")
            : prefix === "MATH"
              ? 0.5
              : prefix === "BULK"
                ? 0.125
                : 0.25;
        courseRows.push(
          `('${prefix}', '${courseNumber}', 100, '2510', ${isOffered}, '${criterion}', ${score}, ${score}, ${priorOnly ? 0 : 1.0}, ${priorOnly ? 0 : 1}::BIGINT, ${cumulativeSamples}::BIGINT, ${priorOnly ? 0 : 1.0}, ${priorOnly ? 0 : 0.5}, 0.1)`,
        );
      }
    }
    if (options.includeScheduleCourse)
      for (const criterion of [
        "content",
        "teaching",
        "grading",
        "workload",
        "course",
        "instructor",
      ])
        courseRows.push(
          `('COMP', '2000', 99, '2430', true, '${criterion}', 0.1, 0.1, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.5, 0.1)`,
        );
    const courseValues = courseRows.join(",\n");
    const courses = `SELECT ${castMeasures} FROM (VALUES ${courseValues}) AS t(subject, code, ${ratingColumns.replace("is_active", "is_offered")})`;
    await copy("course-ratings.parquet", courses);
    await copy(
      "course-rankings.parquet",
      `SELECT * FROM (${courses}) WHERE term_num = 100`,
    );

    const rows: string[] = [];
    for (const identity of fixtureIdentities) {
      for (const criterion of [
        "content",
        "teaching",
        "grading",
        "workload",
        "course",
        "instructor",
      ]) {
        if (
          identity.canonicalName === "Gamma Instructor" &&
          criterion === "instructor"
        )
          continue;
        const priorOnly = identity.canonicalName === "Prior Instructor";
        const cumulativeSamples = priorOnly
          ? 0
          : criterion === "content"
            ? 11
            : criterion === "course"
              ? 22
              : 33;
        const score = priorOnly
          ? 0.75
          : identity.canonicalName === "Delta Instructor"
            ? Number(criterion === "content")
            : identity.canonicalName === "Gamma Instructor" ||
                identity.canonicalName === "Historical Instructor"
              ? 0.5
              : 1;
        const isTeaching = identity.canonicalName !== "Historical Instructor";
        rows.push(
          `('${identity.uuid}', '${identity.canonicalName}', 100, '2510', ${isTeaching}, '${criterion}', ${score}, ${score}, ${priorOnly ? 0 : 1.0}, ${priorOnly ? 0 : 1}::BIGINT, ${cumulativeSamples}::BIGINT, ${priorOnly ? 0 : 1.0}, ${priorOnly ? 0 : 0.5}, 0.1)`,
        );
      }
    }
    const instructorValues = rows.join(",\n");
    const instructorRatings = `SELECT ${castMeasures} FROM (VALUES ${instructorValues}) AS t(uuid, name, ${ratingColumns.replace("is_active", "is_teaching")})`;
    await copy(
      "instructor-ratings.parquet",
      malformation === "legacy-name-keyed"
        ? `SELECT * EXCLUDE (uuid) FROM (${instructorRatings})`
        : instructorRatings,
    );
    const instructorRankings =
      malformation === "legacy-name-keyed"
        ? `SELECT * EXCLUDE (uuid) FROM (${instructorRatings})`
        : instructorRatings;
    const malformedInstructorRankings =
      malformation === "invalid-schema"
        ? `SELECT * EXCLUDE (posterior_stddev) FROM (${instructorRankings})`
        : malformation === "duplicate-grain"
          ? `WITH rankings AS (${instructorRankings}) SELECT * FROM rankings UNION ALL SELECT * FROM rankings`
          : malformation === "null-samples"
            ? `SELECT * REPLACE (NULL::BIGINT AS samples, NULL::BIGINT AS cumulative_samples) FROM (${instructorRankings})`
            : malformation === "non-finite"
              ? `SELECT * REPLACE ('NaN'::DOUBLE AS bayesian) FROM (${instructorRankings})`
              : malformation === "wrong-latest-term"
                ? `SELECT * REPLACE (99::INTEGER AS term_num) FROM (${instructorRankings})`
                : instructorRankings;
    await copy("instructor-rankings.parquet", malformedInstructorRankings);
    const sameNameWithoutUniqueAlias =
      malformation === "ambiguous-canonical-name" ||
      options.sameNameAssociations;
    const secondInstructorName =
      sameNameWithoutUniqueAlias || options.sameNameSplit
        ? "Alpha Instructor"
        : "Beta Instructor";
    const secondCoursePrefix =
      malformation === "ambiguous-canonical-name" ? "COMP" : "MATH";
    const secondCourseNumber =
      malformation === "ambiguous-canonical-name" || options.sameNameSplit
        ? "1000"
        : "2000";
    const additionalBetaAssociation = sameNameWithoutUniqueAlias
      ? ""
      : ", ('00000000-0000-4000-8000-000000000002', 'Beta Instructor', 100, '2510', 'COMP', '1029C')";
    await copy(
      "course-instructors.parquet",
      `SELECT ${malformation === "failed-smoke-query" ? "* REPLACE ('10000000-0000-4000-8000-000000000000' AS uuid)" : malformation === "legacy-name-keyed" ? "* EXCLUDE (uuid)" : "*"} FROM (VALUES
        ('00000000-0000-4000-8000-000000000001', 'Alpha Instructor', 100, '2510', 'COMP', '1000'),
        ('00000000-0000-4000-8000-000000000002', '${secondInstructorName}', 100, '2510', '${secondCoursePrefix}', '${secondCourseNumber}')
        ${additionalBetaAssociation},
        ('00000000-0000-4000-8000-000000000003', 'Delta Instructor', 100, '2510', 'HIST', '3000'),
        ('00000000-0000-4000-8000-000000000004', 'Gamma Instructor', 100, '2510', 'MISS', '4000'),
        ('00000000-0000-4000-8000-000000000005', 'Historical Instructor', 100, '2510', 'COMP', '1000')
        ${options.includeScheduleCourse ? ", ('00000000-0000-4000-8000-000000000001', 'Alpha Instructor', 100, '2510', 'COMP', '2000'), ('00000000-0000-4000-8000-000000000001', 'Alpha Instructor', 99, '2430', 'COMP', '2000')" : ""}
      ) AS t(uuid, name, term_num, term_code, subject, code)`,
    );
    const courseDimension = `SELECT * FROM (VALUES
      ('COMP', '1000', '${options.firstCourseTitle ?? "Creative Computing"}', [
        {'label': 'CC22', 'value': '26', 'description': 'Science'},
        {'label': 'CC25', 'value': '37', 'description': 'Arts'}
      ]),
      ('COMP', '1029C', 'Special Topics in Computing', [
        {'label': 'CC25', 'value': '40', 'description': 'Technology'}
      ]),
      ('MATH', '${options.sameNameSplit ? "1000" : "2000"}', 'Mathematical Thinking', [
        {'label': 'CC25', 'value': '39', 'description': 'Science'}
      ]),
      ('HIST', '3000', 'History and Society', [
        {'label': 'CC25', 'value': '38', 'description': 'Humanities'}
      ])
      ${options.includeScheduleCourse ? ", ('COMP', '2000', 'Updated Course title', [])" : ""}
      ${options.includePriorOnly ? ", ('OFFR', '5000', 'Offered Without Samples', [])" : ""}
      ${Array.from({ length: options.extraCourses ?? 0 }, (_, index) => `, ('BULK', '${1000 + index}', 'Bulk Course ${1000 + index}', [])`).join("")}
    ) AS t(prefix, number, title, attributes)`;
    await copy(
      "courses.parquet",
      malformation === "malformed-course-dimension"
        ? `SELECT * EXCLUDE (attributes) FROM (${courseDimension})`
        : malformation === "invalid-course-dimension"
          ? `SELECT * REPLACE ('' AS title) FROM (${courseDimension})`
          : malformation === "duplicate-course-dimension"
            ? `WITH courses AS (${courseDimension}) SELECT * FROM courses UNION ALL (SELECT * FROM courses LIMIT 1)`
            : courseDimension,
    );

    if (malformation === "tba-alias") {
      fixtureIdentities[0].aliases[0].name = " TBA ";
    }
    const identityRows = fixtureIdentities
      .map(
        (identity) =>
          `('${identity.uuid}', '${identity.canonicalName.replaceAll("'", "''")}', ${
            "itsc" in identity && identity.itsc ? `'${identity.itsc}'` : "NULL"
          })`,
      )
      .join(", ");
    await copy(
      "instructor-identities.parquet",
      `SELECT * FROM (VALUES ${identityRows}) AS t(uuid, canonical_name, itsc)`,
    );
    const aliasRows = fixtureIdentities
      .flatMap((identity) =>
        identity.aliases.map(
          (alias) =>
            `('${identity.uuid}', '${alias.name.replaceAll("'", "''")}', '${alias.source}', '${alias.sourceCommit}', ${
              "sourceFile" in alias && alias.sourceFile
                ? `'${alias.sourceFile}'`
                : "NULL"
            })`,
        ),
      )
      .join(", ");
    await copy(
      "instructor-aliases.parquet",
      `SELECT * FROM (VALUES ${aliasRows}) AS t(uuid, name, source, source_commit, source_file)`,
    );
    const identityEvents = options.sameNameSplit
      ? [
          {
            type: "split" as const,
            sourceUuid: fixtureIdentities[0]?.uuid ?? "",
            newUuid: fixtureIdentities[1]?.uuid ?? "",
            sourceCommit: fixtureSha,
          },
        ]
      : (options.identityEvents ?? []);
    await copy(
      "instructor-identity-events.parquet",
      identityEvents.length === 0
        ? `SELECT * FROM (VALUES
        (NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR)
      ) AS t(event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid)
      WHERE 1 = 0`
        : `SELECT * FROM (VALUES ${identityEvents
            .map((event) =>
              event.type === "itsc-added"
                ? `('${event.type}', '${event.sourceCommit}', '${event.uuid}', '${event.itsc}', NULL, NULL, NULL, NULL)`
                : event.type === "merge"
                  ? `('${event.type}', '${event.sourceCommit}', NULL, NULL, '${event.retiredUuid}', '${event.survivorUuid}', NULL, NULL)`
                  : `('${event.type}', '${event.sourceCommit}', NULL, NULL, NULL, NULL, '${event.sourceUuid}', '${event.newUuid}')`,
            )
            .join(
              ", ",
            )}) AS t(event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid)`,
    );
    const associationCorrections = options.sameNameSplit
      ? [
          {
            correctionType: "split" as const,
            sourceCommit: fixtureSha,
            targetUuid: fixtureIdentities[1]?.uuid ?? "",
            sourceName: fixtureIdentities[1]?.canonicalName ?? "",
            termCode: "2510",
            courseCode: "MATH 1000",
          },
        ]
      : (options.associationCorrections ?? []);
    await copy(
      "instructor-split-affected-associations.parquet",
      associationCorrections.length === 0
        ? `SELECT * FROM (VALUES
          (NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR)
        ) AS t(correction_type, source_commit, target_uuid, source_name, term_code, course_code)
        WHERE 1 = 0`
        : `SELECT * FROM (VALUES ${associationCorrections
            .map(
              (correction) =>
                `('${correction.correctionType}', '${correction.sourceCommit}', '${correction.targetUuid}', '${correction.sourceName.replaceAll("'", "''")}', ${correction.termCode ? `'${correction.termCode}'` : "NULL"}, ${correction.courseCode ? `'${correction.courseCode}'` : "NULL"})`,
            )
            .join(
              ", ",
            )}) AS t(correction_type, source_commit, target_uuid, source_name, term_code, course_code)`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  const filenames = [
    "courses.parquet",
    "course-instructors.parquet",
    "course-rankings.parquet",
    "course-ratings.parquet",
    "instructor-rankings.parquet",
    "instructor-ratings.parquet",
  ];
  const artifacts = Object.fromEntries(
    await Promise.all(
      filenames.map(async (name) => [
        name,
        {
          sha256: await hash(join(directory, name)),
          size: (await stat(join(directory, name))).size,
        },
      ]),
    ),
  );
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ schemaMajor: 0, sourceCommit: fixtureSha, artifacts, identities: fixtureIdentities }, null, 2)}\n`,
  );
  if (
    malformation === "missing-course-dimension" ||
    malformation === "legacy-name-keyed"
  )
    await rm(join(directory, "courses.parquet"));
  return directory;
}

export async function makeRankingGenerationWithSha(
  root: string,
  sha: string,
  malformation?: Malformation,
  options?: Parameters<typeof makeRankingGeneration>[2],
) {
  const original = await makeRankingGeneration(root, malformation, options);
  const target = join(root, sha);
  const manifestPath = join(original, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    sourceCommit: string;
    identities: Array<{ aliases: Array<{ sourceCommit: string }> }>;
  };
  manifest.sourceCommit = sha;
  for (const identity of manifest.identities)
    for (const alias of identity.aliases) alias.sourceCommit = sha;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await rename(original, target);
  return target;
}
