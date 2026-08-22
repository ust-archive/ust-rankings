import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve("scripts/create-image-app-spec.ts");
const digest = `sha256:${"a".repeat(64)}`;

test("deployment preserves the app configuration while replacing the web source with a verified image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ust-rankings-app-spec-"));
  const input = join(directory, "app.json");
  const output = join(directory, "spec.json");
  await writeFile(
    input,
    JSON.stringify([
      {
        spec: {
          name: "ust-rankings",
          region: "sgp",
          domains: [{ domain: "ust-rankings.com", type: "PRIMARY" }],
          services: [
            {
              name: "web",
              git: { repo_clone_url: "https://example.com/repo.git" },
              dockerfile_path: "Dockerfile",
              envs: [{ key: "AUTH_SECRET", value: "encrypted" }],
              instance_count: 1,
            },
          ],
        },
      },
    ]),
  );

  try {
    await execFileAsync(process.execPath, [script, input, digest, output]);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({
      name: "ust-rankings",
      region: "sgp",
      domains: [{ domain: "ust-rankings.com", type: "PRIMARY" }],
      services: [
        {
          name: "web",
          image: {
            registry_type: "GHCR",
            registry: "ust-archive",
            repository: "ust-rankings",
            digest,
          },
          envs: [{ key: "AUTH_SECRET", value: "encrypted" }],
          instance_count: 1,
        },
      ],
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("deployment rejects an unverified image reference", async () => {
  await expect(
    execFileAsync(process.execPath, [script, "unused", "latest", "unused"]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("Image digest must be a sha256 digest"),
  });
});
