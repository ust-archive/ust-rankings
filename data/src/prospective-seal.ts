import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const dataRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = dirname(dataRoot);
const legacyManifestSha256 =
  "81cab9eb43d0dd6b62dd012e7bec9159d92a63c4d0752aa67df722d6755f0c47";
const revisionPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;
// The inspected pinned Review snapshot already contained outcome Term 103.
const minimumKnownOutcomeTerm = 103;

type Candidate = {
  id: string;
  role: "control" | "challenger";
  parameters: {
    timelinessBase: number;
    courseInstructorMultiplier: number;
    reviewVoteScale: number;
    sfqRatePenalty: number;
    contextAffectsUncertainty: boolean;
  };
};

export type Protocol = {
  schemaVersion: 1;
  createdAt: string;
  knownOutcomeCeilingTerm: number;
  firstOutcomeTerm: number;
  inspectedSourceRevisions: string[];
  legacyManifestSha256: string;
  implementationSha256: string;
  candidateRegistry: Candidate[];
  sealWhen: {
    minimumDistinctOutcomeTerms: number;
    minimumCourseUnits: number;
    minimumDistinctCourses: number;
    minimumInstructorUnits: number;
    minimumDistinctInstructors: number;
  };
  acceptance: {
    minimumRelativePrimaryImprovement: number;
    maximumRelativeRegressionInAnyPredeclaredCriterionOrSource: number;
    requireCourseClusterUpper95BelowZero: boolean;
    requireTermBlockUpper95BelowZero: boolean;
  };
  intervalRule: "normal-model-plus-source-noise-v1";
  bootstrap: { replicates: 2000; seed: 167 };
  baselineRegistry: ["population", "unshrunk", "latest", "rolling"];
  coverageTargets: [0.5, 0.8, 0.9, 0.95];
  coverageAcceptanceRule: "empirical-coverage-at-least-nominal-at-each-level";
  baselineAcceptanceRule: "strictly-lower-primary-mae-than-every-baseline";
};

export type ProspectiveProtocol = Protocol;

type LegacyManifest = {
  frozenAt: string;
  developmentOutcomeCeilingTerm: number;
  trainingSources: Record<string, string>;
  candidateRegistry: Protocol["candidateRegistry"];
  holdout: { sealWhen: Protocol["sealWhen"] };
  acceptance: { course: Protocol["acceptance"] };
};

export type SourceFile = {
  name: string;
  path: string;
  sha256: string;
  revision: string;
  acquiredAt: string;
};

export type Seal<M = Record<string, unknown>> = {
  schemaVersion: 1;
  sealedAt: string;
  metadata: M;
  files: Array<Omit<SourceFile, "path">>;
  sha256: string;
};

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function timestamp(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().replace(".000Z", "Z") !==
      value.replace(".000Z", "Z")
  )
    throw new Error("Expected a valid UTC timestamp");
  return Date.parse(value);
}

async function legacyManifest(): Promise<LegacyManifest> {
  const bytes = await readFile(
    join(dataRoot, "validation/future-holdout.json"),
  );
  if (sha256(bytes) !== legacyManifestSha256)
    throw new Error("The original frozen holdout manifest has changed");
  return JSON.parse(bytes.toString());
}

export async function implementationSha256(): Promise<string> {
  const paths = [
    "lib/instructor-identity.ts",
    "lib/server-index-contract.ts",
    "package-lock.json",
  ];
  for (const [directory, suffix] of [
    ["data/src", ".ts"],
    ["data/sql", ".sql"],
  ] as const) {
    for (const name of await readdir(join(repositoryRoot, directory))) {
      if (name.endsWith(suffix)) paths.push(`${directory}/${name}`);
    }
  }
  const hashes = [];
  for (const path of paths.sort()) {
    hashes.push([path, sha256(await readFile(join(repositoryRoot, path)))]);
  }
  return sha256(JSON.stringify(hashes));
}

async function validateProtocol(value: Protocol): Promise<void> {
  const legacy = await legacyManifest();
  if (!value || typeof value !== "object")
    throw new Error("Invalid prospective protocol");
  if (
    value.schemaVersion !== 1 ||
    value.legacyManifestSha256 !== legacyManifestSha256 ||
    value.implementationSha256 !== (await implementationSha256()) ||
    !isDeepStrictEqual(value.candidateRegistry, legacy.candidateRegistry) ||
    !isDeepStrictEqual(value.sealWhen, legacy.holdout.sealWhen) ||
    !isDeepStrictEqual(value.acceptance, legacy.acceptance.course) ||
    value.intervalRule !== "normal-model-plus-source-noise-v1" ||
    !isDeepStrictEqual(value.bootstrap, { replicates: 2000, seed: 167 }) ||
    !isDeepStrictEqual(value.baselineRegistry, [
      "population",
      "unshrunk",
      "latest",
      "rolling",
    ]) ||
    !isDeepStrictEqual(value.coverageTargets, [0.5, 0.8, 0.9, 0.95]) ||
    value.coverageAcceptanceRule !==
      "empirical-coverage-at-least-nominal-at-each-level" ||
    value.baselineAcceptanceRule !==
      "strictly-lower-primary-mae-than-every-baseline"
  )
    throw new Error(
      "Prospective protocol differs from the frozen rules or implementation",
    );
  if (
    !Number.isSafeInteger(value.knownOutcomeCeilingTerm) ||
    value.knownOutcomeCeilingTerm <
      Math.max(legacy.developmentOutcomeCeilingTerm, minimumKnownOutcomeTerm) ||
    !Number.isSafeInteger(value.firstOutcomeTerm) ||
    value.firstOutcomeTerm <= value.knownOutcomeCeilingTerm
  )
    throw new Error(
      "The first outcome Term must follow all known development outcomes",
    );
  if (
    timestamp(value.createdAt) <= timestamp(legacy.frozenAt) ||
    timestamp(value.createdAt) > Date.now()
  )
    throw new Error(
      "A new prospective protocol must be frozen now, not reuse the old freeze",
    );
  if (
    !Array.isArray(value.inspectedSourceRevisions) ||
    value.inspectedSourceRevisions.some(
      (revision) =>
        typeof revision !== "string" || !revisionPattern.test(revision),
    ) ||
    new Set(value.inspectedSourceRevisions).size !==
      value.inspectedSourceRevisions.length ||
    Object.values(legacy.trainingSources).some(
      (revision) => !value.inspectedSourceRevisions.includes(revision),
    )
  )
    throw new Error(
      "Inspected revisions must include every original training source",
    );
}

export async function createProtocol(
  path: string,
  input: Pick<
    Protocol,
    "knownOutcomeCeilingTerm" | "firstOutcomeTerm" | "inspectedSourceRevisions"
  >,
): Promise<{ protocol: Protocol; sha256: string }> {
  const legacy = await legacyManifest();
  if (!Array.isArray(input.inspectedSourceRevisions))
    throw new Error("Inspected source revisions are required");
  const protocol: Protocol = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    knownOutcomeCeilingTerm: input.knownOutcomeCeilingTerm,
    firstOutcomeTerm: input.firstOutcomeTerm,
    inspectedSourceRevisions: [
      ...new Set([
        ...Object.values(legacy.trainingSources),
        ...input.inspectedSourceRevisions,
      ]),
    ].sort(),
    legacyManifestSha256,
    implementationSha256: await implementationSha256(),
    candidateRegistry: legacy.candidateRegistry,
    sealWhen: legacy.holdout.sealWhen,
    acceptance: legacy.acceptance.course,
    intervalRule: "normal-model-plus-source-noise-v1",
    bootstrap: { replicates: 2000, seed: 167 },
    baselineRegistry: ["population", "unshrunk", "latest", "rolling"],
    coverageTargets: [0.5, 0.8, 0.9, 0.95],
    coverageAcceptanceRule: "empirical-coverage-at-least-nominal-at-each-level",
    baselineAcceptanceRule: "strictly-lower-primary-mae-than-every-baseline",
  };
  await validateProtocol(protocol);
  const bytes = `${JSON.stringify(protocol, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx", flush: true });
  return { protocol, sha256: sha256(bytes) };
}

export async function readProtocol(path: string) {
  const bytes = await readFile(path);
  const protocol: Protocol = JSON.parse(bytes.toString());
  await validateProtocol(protocol);
  return { protocol, sha256: sha256(bytes) };
}

function validateFiles(files: Array<Omit<SourceFile, "path">>): void {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error("A seal requires source files");
  const names = new Set<string>();
  for (const file of files) {
    if (
      !file ||
      typeof file.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name) ||
      file.name.endsWith(".") ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name) ||
      file.name.toLowerCase() === "seal.json" ||
      names.has(file.name.toLowerCase()) ||
      typeof file.sha256 !== "string" ||
      !digestPattern.test(file.sha256) ||
      typeof file.revision !== "string" ||
      !revisionPattern.test(file.revision)
    )
      throw new Error(
        "Source files need unique safe names, SHA-256 hashes and immutable revisions",
      );
    if (timestamp(file.acquiredAt) > Date.now())
      throw new Error("A source cannot have a future acquisition timestamp");
    names.add(file.name.toLowerCase());
  }
}

async function verifiedBytes(file: SourceFile): Promise<Buffer> {
  if (typeof file.path !== "string" || !file.path)
    throw new Error("Source file path is required");
  const bytes = await readFile(file.path);
  if (sha256(bytes) !== file.sha256)
    throw new Error(`Source file hash mismatch: ${file.name}`);
  return bytes;
}

export async function verifySourceFiles(files: SourceFile[]): Promise<void> {
  validateFiles(files);
  for (const file of files) await verifiedBytes(file);
}

export async function sealBundle<M>(
  directory: string,
  metadata: M,
  files: SourceFile[],
): Promise<Seal<M>> {
  await verifySourceFiles(files);
  // A failed seal leaves an incomplete directory that cannot be reused or read as sealed.
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  for (const file of files) {
    await writeFile(join(directory, file.name), await verifiedBytes(file), {
      flag: "wx",
    });
  }
  const seal = {
    schemaVersion: 1 as const,
    sealedAt: new Date().toISOString(),
    metadata,
    files: files.map(({ name, sha256, revision, acquiredAt }) => ({
      name,
      sha256,
      revision,
      acquiredAt,
    })),
  };
  const bytes = `${JSON.stringify(seal, null, 2)}\n`;
  await writeFile(join(directory, "seal.json"), bytes, {
    flag: "wx",
    flush: true,
  });
  return { ...seal, sha256: sha256(bytes) };
}

export async function readSeal<M = Record<string, unknown>>(
  directory: string,
): Promise<Seal<M>> {
  const bytes = await readFile(join(directory, "seal.json"));
  const seal: Omit<Seal<M>, "sha256"> = JSON.parse(bytes.toString());
  if (seal?.schemaVersion !== 1 || !("metadata" in seal))
    throw new Error("Invalid source seal");
  if (timestamp(seal.sealedAt) > Date.now())
    throw new Error("A seal cannot be dated in the future");
  validateFiles(seal.files);
  if (
    seal.files.some(
      (file) => timestamp(file.acquiredAt) > timestamp(seal.sealedAt),
    )
  )
    throw new Error("A source was acquired after the seal");
  await verifySourceFiles(
    seal.files.map((file) => ({ ...file, path: join(directory, file.name) })),
  );
  return { ...seal, sha256: sha256(bytes) };
}

type SealRegistration = {
  schemaVersion: 1;
  sealHash: string;
  kind: "forecast" | "outcomes";
  protocolSha256: string;
  sealedAt: string;
  registeredAt: string;
};

function validateRegistration(record: SealRegistration): void {
  if (
    record?.schemaVersion !== 1 ||
    typeof record.sealHash !== "string" ||
    !digestPattern.test(record.sealHash) ||
    typeof record.protocolSha256 !== "string" ||
    !digestPattern.test(record.protocolSha256) ||
    (record.kind !== "forecast" && record.kind !== "outcomes")
  )
    throw new Error("Invalid seal registration");
  if (
    timestamp(record.registeredAt) < timestamp(record.sealedAt) ||
    timestamp(record.registeredAt) > Date.now()
  )
    throw new Error("Invalid seal registration chronology");
}

export async function registerSeal(
  registryDirectory: string,
  sealHash: string,
  kind: SealRegistration["kind"],
  protocolSha256: string,
  sealedAt: string,
): Promise<SealRegistration> {
  const record: SealRegistration = {
    schemaVersion: 1,
    sealHash,
    kind,
    protocolSha256,
    sealedAt,
    registeredAt: new Date().toISOString(),
  };
  validateRegistration(record);
  const directory = join(registryDirectory, "seals");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${sealHash}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    {
      flag: "wx",
      flush: true,
    },
  );
  return record;
}

export async function assertRegisteredSeal(
  registryDirectory: string,
  sealHash: string,
  kind: SealRegistration["kind"],
  protocolSha256: string,
  sealedAt: string,
): Promise<SealRegistration> {
  if (!digestPattern.test(sealHash)) throw new Error("Invalid seal hash");
  const record: SealRegistration = JSON.parse(
    await readFile(
      join(registryDirectory, "seals", `${sealHash}.json`),
      "utf8",
    ),
  );
  validateRegistration(record);
  if (
    !isDeepStrictEqual(record, {
      schemaVersion: 1,
      sealHash,
      kind,
      protocolSha256,
      sealedAt,
      registeredAt: record.registeredAt,
    })
  )
    throw new Error("Seal registration does not match this artifact");
  return record;
}

type EvaluationReceipt = {
  schemaVersion: 1;
  claimedAt: string;
  sealHash: string;
  outcomeKeys: string[];
};

function validateOutcomeKeys(keys: string[]): void {
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some(
      (key) => typeof key !== "string" || !key.trim() || key !== key.trim(),
    ) ||
    new Set(keys).size !== keys.length
  )
    throw new Error("Evaluation requires nonempty unique stable outcome keys");
}

export async function claimEvaluation(
  registryDirectory: string,
  outcomeKeys: string[],
  sealHash: string,
): Promise<{ receiptPath: string; release: () => Promise<void> }> {
  validateOutcomeKeys(outcomeKeys);
  if (!digestPattern.test(sealHash))
    throw new Error("Invalid outcome seal hash");
  await mkdir(registryDirectory, { recursive: true });
  const lock = join(registryDirectory, "evaluation-lock");
  await mkdir(lock);
  let released = false;
  const release = async () => {
    if (released) return;
    await rmdir(lock);
    released = true;
  };
  try {
    const receiptsDirectory = join(registryDirectory, "evaluations");
    await mkdir(receiptsDirectory, { recursive: true });
    const requested = new Set(outcomeKeys);
    for (const filename of await readdir(receiptsDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/.test(filename))
        throw new Error("Unexpected file in the evaluation registry");
      const receipt: EvaluationReceipt = JSON.parse(
        await readFile(join(receiptsDirectory, filename), "utf8"),
      );
      if (
        receipt?.schemaVersion !== 1 ||
        `${receipt.sealHash}.json` !== filename
      )
        throw new Error("Invalid evaluation receipt");
      timestamp(receipt.claimedAt);
      validateOutcomeKeys(receipt.outcomeKeys);
      if (receipt.outcomeKeys.some((key) => requested.has(key)))
        throw new Error(
          "An outcome has already been consumed by an evaluation",
        );
    }
    const receiptPath = join(receiptsDirectory, `${sealHash}.json`);
    const receipt: EvaluationReceipt = {
      schemaVersion: 1,
      claimedAt: new Date().toISOString(),
      sealHash,
      outcomeKeys: [...outcomeKeys].sort(),
    };
    // Persist consumption before the caller can inspect metrics, including failed evaluations.
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
      flush: true,
    });
    return { receiptPath, release };
  } catch (error) {
    await release();
    throw error;
  }
}
