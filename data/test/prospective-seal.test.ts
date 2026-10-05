import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  assertRegisteredSeal,
  claimEvaluation,
  createProtocol,
  implementationSha256,
  readProtocol,
  readSeal,
  registerSeal,
  type SourceFile,
  sealBundle,
  sha256,
  verifySourceFiles,
} from "../src/prospective-seal.ts";

test("only previously registered seal hashes can be reused and their kind, protocol and timestamp stay bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "prospective-registration-"));
  try {
    const hash = "2".repeat(64);
    const protocolHash = "3".repeat(64);
    const sealedAt = "2026-09-01T00:00:00Z";
    const record = await registerSeal(
      root,
      hash,
      "forecast",
      protocolHash,
      sealedAt,
    );
    assert.deepEqual(
      await assertRegisteredSeal(
        root,
        hash,
        "forecast",
        protocolHash,
        sealedAt,
      ),
      record,
    );
    await assert.rejects(
      registerSeal(root, hash, "forecast", protocolHash, sealedAt),
      /EEXIST/,
    );
    await assert.rejects(
      assertRegisteredSeal(
        root,
        "4".repeat(64),
        "forecast",
        protocolHash,
        sealedAt,
      ),
      /ENOENT/,
    );
    await assert.rejects(
      assertRegisteredSeal(root, hash, "outcomes", protocolHash, sealedAt),
      /does not match/,
    );
    await assert.rejects(
      assertRegisteredSeal(root, hash, "forecast", "5".repeat(64), sealedAt),
      /does not match/,
    );
    await assert.rejects(
      assertRegisteredSeal(
        root,
        hash,
        "forecast",
        protocolHash,
        "2026-09-02T00:00:00Z",
      ),
      /does not match/,
    );
    await writeFile(
      join(root, "seals", `${hash}.json`),
      JSON.stringify({ ...record, sealHash: "0".repeat(64) }),
    );
    await assert.rejects(
      assertRegisteredSeal(root, hash, "forecast", protocolHash, sealedAt),
      /does not match/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a fresh protocol preserves the frozen rules and rejects inspected outcomes and implementation drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "prospective-protocol-"));
  try {
    const path = join(root, "protocol.json");
    const input = {
      knownOutcomeCeilingTerm: 103,
      firstOutcomeTerm: 104,
      inspectedSourceRevisions: ["a".repeat(40)],
    };
    const created = await createProtocol(path, input);
    assert.deepEqual(await readProtocol(path), created);
    assert.equal(
      created.protocol.implementationSha256,
      await implementationSha256(),
    );
    assert.equal(created.protocol.inspectedSourceRevisions.length, 6);
    await assert.rejects(createProtocol(path, input), /EEXIST/);
    await assert.rejects(
      createProtocol(join(root, "old.json"), {
        ...input,
        knownOutcomeCeilingTerm: 102,
        firstOutcomeTerm: 103,
      }),
      /follow all known/,
    );
    await assert.rejects(
      createProtocol(join(root, "overlap.json"), {
        ...input,
        firstOutcomeTerm: 103,
      }),
      /follow all known/,
    );
    const mutations = [
      { candidateRegistry: [] },
      { sealWhen: { ...created.protocol.sealWhen, minimumCourseUnits: 1 } },
      {
        acceptance: {
          ...created.protocol.acceptance,
          minimumRelativePrimaryImprovement: 0,
        },
      },
      { bootstrap: { replicates: 1, seed: 167 } },
      { intervalRule: "fit-on-outcomes" },
      { baselineRegistry: ["population"] },
      { coverageTargets: [0.5] },
      { coverageAcceptanceRule: "post-hoc-tolerance" },
      { baselineAcceptanceRule: "ignore-stronger-baselines" },
      { legacyManifestSha256: "0".repeat(64) },
      { implementationSha256: "0".repeat(64) },
      { createdAt: "2026-08-29T16:23:26Z" },
      { createdAt: "2999-01-01T00:00:00Z" },
      { inspectedSourceRevisions: ["a".repeat(40)] },
    ];
    for (const mutation of mutations) {
      await writeFile(
        path,
        JSON.stringify({ ...created.protocol, ...mutation }),
      );
      await assert.rejects(readProtocol(path));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source seals copy verified bytes, refuse overwrite, and detect source or sealed-file tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "prospective-source-seal-"));
  try {
    const sourcePath = join(root, "source.parquet");
    const original = "accepted immutable source bytes";
    await writeFile(sourcePath, original);
    const source: SourceFile = {
      name: "source.parquet",
      path: sourcePath,
      sha256: sha256(original),
      revision: "b".repeat(40),
      acquiredAt: "2026-09-01T00:00:00Z",
    };
    await verifySourceFiles([source]);
    for (const name of ["../escape", "seal.json", "NUL.parquet", "trailing."]) {
      await assert.rejects(
        verifySourceFiles([{ ...source, name }]),
        /unique safe names/,
      );
    }
    await assert.rejects(
      verifySourceFiles([source, { ...source, name: "SOURCE.PARQUET" }]),
      /unique safe names/,
    );
    await assert.rejects(
      verifySourceFiles([{ ...source, revision: "main" }]),
      /immutable revisions/,
    );
    await assert.rejects(
      verifySourceFiles([{ ...source, acquiredAt: "2999-01-01T00:00:00Z" }]),
      /future/,
    );
    await assert.rejects(
      verifySourceFiles([{ ...source, sha256: "0".repeat(64) }]),
      /hash mismatch/,
    );
    const directory = join(root, "sealed");
    const seal = await sealBundle(
      directory,
      { protocolSha256: "c".repeat(64) },
      [source],
    );
    assert.deepEqual(await readSeal(directory), seal);
    await assert.rejects(sealBundle(directory, {}, [source]), /EEXIST/);
    await writeFile(sourcePath, "a correction acquired later");
    assert.deepEqual(await readSeal(directory), seal);
    await assert.rejects(verifySourceFiles([source]), /hash mismatch/);
    await writeFile(
      join(directory, source.name),
      "a changed accepted identity",
    );
    await assert.rejects(readSeal(directory), /hash mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation receipts consume stable outcomes before scoring and serialize concurrent attempts", async () => {
  const root = await mkdtemp(join(tmpdir(), "prospective-receipts-"));
  try {
    const outcomes = ["sfq:class-104:course", "sfq:class-104:instructor-uuid"];
    const firstHash = "d".repeat(64);
    await assert.rejects(
      claimEvaluation(
        root,
        [outcomes[0] as string, outcomes[0] as string],
        firstHash,
      ),
      /unique stable/,
    );
    const first = await claimEvaluation(root, outcomes, firstHash);
    const receipt = JSON.parse(await readFile(first.receiptPath, "utf8"));
    assert.deepEqual(receipt.outcomeKeys, [...outcomes].sort());
    await assert.rejects(
      claimEvaluation(root, ["another outcome"], "e".repeat(64)),
      /EEXIST/,
    );
    // Even if scoring throws after this point, releasing the lock does not unconsume outcomes.
    await first.release();
    await first.release();
    await assert.rejects(
      claimEvaluation(root, outcomes, "f".repeat(64)),
      /already been consumed/,
    );
    const second = await claimEvaluation(
      root,
      ["another outcome"],
      "e".repeat(64),
    );
    await second.release();
    await writeFile(first.receiptPath, "incomplete receipt");
    await assert.rejects(
      claimEvaluation(root, ["unseen outcome"], "1".repeat(64)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
