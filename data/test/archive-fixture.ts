import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

type ArchiveWriter = {
  copy(name: string, query: string): Promise<void>;
  file(name: string): string;
};

export async function writeArchiveFixture(
  directory: string,
  sourceCommit: string,
  inputs: readonly string[],
  write: (writer: ArchiveWriter) => Promise<void>,
) {
  await mkdir(directory, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const path = (name: string) => join(directory, name);
  const file = (name: string) => path(name).replaceAll("\\", "/");

  try {
    await write({
      file,
      async copy(name, query) {
        await mkdir(dirname(path(name)), { recursive: true });
        await connection.run("SET VARIABLE fixture_output = $path", {
          path: file(name),
        });
        await connection.run(
          `COPY (${query}) TO (getvariable('fixture_output')) (FORMAT parquet)`,
        );
      },
    });
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  const artifacts = Object.fromEntries(
    await Promise.all(
      inputs.map(async (name) => {
        const bytes = await readFile(path(name));
        return [
          name,
          {
            size: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ];
      }),
    ),
  );
  await writeFile(
    path("manifest.json"),
    `${JSON.stringify({ schemaMajor: 0, sourceCommit, artifacts })}\n`,
  );
  return directory;
}
