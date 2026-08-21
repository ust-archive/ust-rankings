import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const forbiddenFiles = [
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".eslintrc",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  "prettier.config.mjs",
  "data/bun.lock",
  "vercel.json",
];

const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (tracked.status !== 0) throw new Error(tracked.stderr);

const trackedFiles = tracked.stdout.split("\0").filter(Boolean);
const errors = forbiddenFiles
  .filter((file) => existsSync(file))
  .map((file) => `unsupported toolchain file: ${file}`);

const activeRoots = [
  ".github/",
  "app/",
  "components/",
  "data/",
  "lib/",
  "scripts/",
  "test/",
];
const activeRootFiles = new Set([
  "package.json",
  "biome.json",
  "next.config.mjs",
  "postcss.config.cjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "README.md",
  "vitest.config.ts",
]);
const ignoredFiles = new Set([
  "scripts/check-toolchain.ts",
  "data/PLAN.md",
  "data/SPECIFICATION.md",
]);
const staleReferences = [
  ["js" + "-joda", "superseded date/time library"],
  ["@upstash/" + "redis", "removed reaction store"],
  ["es" + "lint", "removed linter"],
  ["pre" + "ttier", "removed formatter"],
  ["pn" + "pm ", "unsupported package manager command"],
  ["y" + "arn ", "unsupported package manager command"],
  ["b" + "un ", "removed runtime command"],
  ["B" + "un.", "removed runtime API"],
  ["b" + "un:test", "removed test runner"],
  ["setup-" + "bun", "removed CI action"],
  ["t" + "sx ", "removed TypeScript runtime"],
  ["--import=" + "tsx", "removed TypeScript runtime hook"],
  ["@" + "vercel/", "retired deployment integration"],
  ["VERCEL_", "retired deployment configuration"],
] as const;

for (const file of trackedFiles) {
  if (
    !existsSync(file) ||
    ignoredFiles.has(file) ||
    (!activeRootFiles.has(file) &&
      !activeRoots.some((root) => file.startsWith(root)))
  ) {
    continue;
  }

  const contents = await readFile(file, "utf8");
  for (const [reference, description] of staleReferences) {
    if (contents.includes(reference)) {
      errors.push(`${file}: ${description}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Toolchain references are Node/npm/Biome/Luxon-only.");
