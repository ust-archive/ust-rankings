import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

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

type Malformation =
  | "invalid-schema"
  | "duplicate-grain"
  | "non-finite"
  | "null-samples"
  | "wrong-latest-term"
  | "failed-smoke-query"
  | "tba-alias";

export async function makeRankingGeneration(
  root: string,
  malformation?: Malformation,
  options: {
    extraCourses?: number;
    extraInstructors?: number;
    includeScheduleCourse?: boolean;
  } = {},
) {
  const directory = join(root, fixtureSha);
  await mkdir(directory, { recursive: true });
  const fixtureIdentities = structuredClone(identities);
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
        const score =
          prefix === "COMP" && courseNumber === "1000"
            ? Number(criterion === "content")
            : prefix === "MATH"
              ? 0.5
              : prefix === "BULK"
                ? 0.125
                : 0.25;
        courseRows.push(
          `('${prefix}', '${courseNumber}', 100, '2510', ${isOffered}, '${criterion}', ${score}, ${score}, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.5, 0.1)`,
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
        const score =
          identity.canonicalName === "Delta Instructor"
            ? Number(criterion === "content")
            : identity.canonicalName === "Gamma Instructor" ||
                identity.canonicalName === "Historical Instructor"
              ? 0.5
              : 1;
        const isTeaching = identity.canonicalName !== "Historical Instructor";
        rows.push(
          `('${identity.canonicalName}', 100, '2510', ${isTeaching}, '${criterion}', ${score}, ${score}, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.5, 0.1)`,
        );
      }
    }
    const instructorValues = rows.join(",\n");
    await copy(
      "instructor-ratings.parquet",
      `SELECT ${castMeasures} FROM (VALUES ${instructorValues}) AS t(name, ${ratingColumns.replace("is_active", "is_teaching")})`,
    );
    const instructorRankings = `SELECT ${castMeasures} FROM (VALUES ${instructorValues}) AS t(name, ${ratingColumns.replace("is_active", "is_teaching")})`;
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
    await copy(
      "course-instructors.parquet",
      `SELECT ${malformation === "failed-smoke-query" ? "* REPLACE ('No ' || name AS name)" : "*"} FROM (VALUES
        ('Alpha Instructor', 100, '2510', 'COMP', '1000'),
        ('Beta Instructor', 100, '2510', 'MATH', '2000'),
        ('Beta Instructor', 100, '2510', 'COMP', '1029C'),
        ('Delta Instructor', 100, '2510', 'HIST', '3000'),
        ('Gamma Instructor', 100, '2510', 'MISS', '4000'),
        ('Historical Instructor', 100, '2510', 'COMP', '1000')
        ${options.includeScheduleCourse ? ", ('Alpha Instructor', 100, '2510', 'COMP', '2000'), ('Alpha Instructor', 99, '2430', 'COMP', '2000')" : ""}
      ) AS t(name, term_num, term_code, subject, code)`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  const filenames = [
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
  if (malformation === "tba-alias") {
    fixtureIdentities[0].aliases[0].name = " TBA ";
  }
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ schemaMajor: 0, sourceCommit: fixtureSha, artifacts, identities: fixtureIdentities }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "course-catalog.json"),
    JSON.stringify([
      {
        coursePrefix: "COMP",
        courseNumber: "1000",
        courseCode: "COMP1000",
        courseName: "Creative Computing",
        courseAttributes: [
          { courseAttribute: "CC25", courseAttributeValue: "37" },
        ],
      },
      {
        coursePrefix: "COMP",
        courseNumber: "1029C",
        courseCode: "COMP1029C",
        courseName: "Special Topics in Computing",
        courseAttributes: [
          { courseAttribute: "CC25", courseAttributeValue: "40" },
        ],
      },
      {
        coursePrefix: "MATH",
        courseNumber: "2000",
        courseCode: "MATH2000",
        courseName: "Mathematical Thinking",
        courseAttributes: [
          { courseAttribute: "CC25", courseAttributeValue: "39" },
        ],
      },
      ...(options.includeScheduleCourse
        ? [
            {
              coursePrefix: "COMP",
              courseNumber: "2000",
              courseCode: "COMP2000",
              courseName: "Updated Course title",
              courseAttributes: [],
            },
          ]
        : []),
      ...Array.from({ length: options.extraCourses ?? 0 }, (_, index) => ({
        coursePrefix: "BULK",
        courseNumber: String(1000 + index),
        courseCode: `BULK${1000 + index}`,
        courseName: `Bulk Course ${1000 + index}`,
        courseAttributes: [],
      })),
      {
        coursePrefix: "HIST",
        courseNumber: "3000",
        courseCode: "HIST3000",
        courseName: "History and Society",
        courseAttributes: [
          { courseAttribute: "CC25", courseAttributeValue: "38" },
        ],
      },
    ]),
  );
  return directory;
}
