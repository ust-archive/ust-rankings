import { existsSync } from "node:fs";

const forbiddenFiles = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
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
];

const tracked = Bun.spawnSync(["git", "ls-files", "-z"]);
if (tracked.exitCode !== 0) {
  throw new Error(tracked.stderr.toString());
}

const trackedFiles = tracked.stdout.toString().split("\0").filter(Boolean);
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
  "postcss.config.js",
  "tailwind.config.ts",
  "tsconfig.json",
  "vercel.json",
  "README.md",
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
  ["n" + "pm ", "unsupported package manager command"],
  ["y" + "arn ", "unsupported package manager command"],
  ["n" + "ode scripts/", "Node-invoked utility command"],
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

  const contents = await Bun.file(file).text();
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

console.log("Toolchain references are Bun/Biome/Luxon-only.");
