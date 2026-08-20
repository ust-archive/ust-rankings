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

export async function makeRankingGeneration(root: string) {
  const directory = join(root, fixtureSha);
  await mkdir(directory, { recursive: true });
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
    await copy(
      "course-ratings.parquet",
      `SELECT ${castMeasures} FROM (VALUES
        ('COMP', '1000', 99, '2440', true, 'content', 0.1, 0.1, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.5, 0.1),
        ('COMP', '1000', 100, '2510', true, 'content', 0.2, 0.2, 1.0, 1::BIGINT, 2::BIGINT, 2.0, 0.5, 0.1)
      ) AS t(subject, code, ${ratingColumns.replace("is_active", "is_offered")})`,
    );
    await copy(
      "course-rankings.parquet",
      `SELECT ${castMeasures} FROM (VALUES
        ('COMP', '1000', 100, '2510', true, 'content', 0.2, 0.2, 1.0, 1::BIGINT, 2::BIGINT, 2.0, 0.5, 0.1)
      ) AS t(subject, code, ${ratingColumns.replace("is_active", "is_offered")})`,
    );

    const rows: string[] = [];
    const scores: Record<string, number> = {
      "Alpha Instructor": 1,
      "Beta Instructor": 1,
      "Delta Instructor": 0,
      "Gamma Instructor": 0.5,
    };
    for (const identity of identities) {
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
        rows.push(
          `('${identity.canonicalName}', 100, '2510', true, '${criterion}', ${scores[identity.canonicalName]}, ${scores[identity.canonicalName]}, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.5, 0.1)`,
        );
      }
    }
    const instructorValues = rows.join(",\n");
    await copy(
      "instructor-ratings.parquet",
      `SELECT ${castMeasures} FROM (VALUES ${instructorValues}) AS t(name, ${ratingColumns.replace("is_active", "is_teaching")})`,
    );
    await copy(
      "instructor-rankings.parquet",
      `SELECT ${castMeasures} FROM (VALUES ${instructorValues}) AS t(name, ${ratingColumns.replace("is_active", "is_teaching")})`,
    );
    await copy(
      "course-instructors.parquet",
      `SELECT * FROM (VALUES
        ('Alpha Instructor', 100, '2510', 'COMP', '1000'),
        ('Beta Instructor', 100, '2510', 'COMP', '1000'),
        ('Delta Instructor', 100, '2510', 'COMP', '1000'),
        ('Gamma Instructor', 100, '2510', 'COMP', '1000')
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
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ schemaMajor: 0, sourceCommit: fixtureSha, artifacts, identities }, null, 2)}\n`,
  );
  return directory;
}
