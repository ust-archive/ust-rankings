import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [directory, sourceCommit, ...files] = process.argv.slice(2);
if (
  !directory ||
  !sourceCommit ||
  !/^[0-9a-f]{40}$/.test(sourceCommit) ||
  !files.length
)
  throw new Error(
    "Usage: node scripts/write-source-manifest.ts <directory> <40-hex> <files...>",
  );
const artifacts = Object.fromEntries(
  await Promise.all(
    files.map(async (name) => {
      const path = resolve(directory, name);
      return [
        name,
        {
          size: (await stat(path)).size,
          sha256: createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        },
      ];
    }),
  ),
);
await writeFile(
  resolve(directory, "manifest.json"),
  `${JSON.stringify({ sourceCommit, artifacts }, null, 2)}\n`,
);
