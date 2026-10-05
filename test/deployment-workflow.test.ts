import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const digest = `sha256:${"a".repeat(64)}`;
const deploymentId = "1ad29b5a-32aa-4f21-b1e8-b3e054e98d8c";
const newerId = "eac2214e-dd85-458f-bdfb-be500dd7e42b";

async function runDeployment(phase: "ERROR" | "ACTIVE") {
  const workflow = await readFile(
    resolve(".github/workflows/deploy.yml"),
    "utf8",
  );
  const script = workflow
    .split(
      "      - name: Deploy verified image to DigitalOcean App Platform",
    )[1]
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const directory = await mkdtemp(join(tmpdir(), "ust-rankings-deploy-"));
  const deployment = {
    id: deploymentId,
    created_at: "2026-09-24T08:14:28Z",
    phase,
    spec: { services: [{ name: "web", image: { digest } }] },
  };
  const newer = {
    ...deployment,
    id: newerId,
    created_at: "2026-09-24T08:26:05Z",
    phase: "BUILDING",
  };
  await mkdir(join(directory, ".deploy"));
  await writeFile(join(directory, ".deploy/image-digest.txt"), `${digest}\n`);

  try {
    const result = await execFileAsync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-eo",
        "pipefail",
        "-c",
        `
doctl() {
  case "$2" in
    update) printf '%s\n' "$MOCK_UPDATED_APP"; return 1 ;;
    list-deployments)
      if [[ "$*" == *"--output json"* ]]; then printf '%s\n' "$MOCK_DEPLOYMENTS";
      else printf '%s\n' "$MOCK_NEWER_ID"; fi ;;
    get-deployment)
      [[ "$4" == "$MOCK_DEPLOYMENT_ID" ]] || return 1
      printf '%s\n' "$MOCK_DEPLOYMENT" ;;
    logs)
      printf 'Logs requested for %s\n' "$*"
      return 1 ;;
    *) return 1 ;;
  esac
}
${script}`,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          DIGITALOCEAN_APP_ID: "test-app",
          MOCK_UPDATED_APP: JSON.stringify([
            { in_progress_deployment: deployment },
          ]),
          MOCK_DEPLOYMENT: JSON.stringify([deployment]),
          MOCK_DEPLOYMENTS: JSON.stringify([newer, deployment]),
          MOCK_DEPLOYMENT_ID: deploymentId,
          MOCK_NEWER_ID: newerId,
        },
      },
    ).then(
      (result) => ({ ...result, code: 0 }),
      (error: { stdout: string; stderr: string; code: number }) => error,
    );
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("failed deployment logs use the update's deployment ID even when a newer deployment exists", async () => {
  const result = await runDeployment("ERROR");
  expect(result.stdout).toContain(`--deployment ${deploymentId}`);
  expect(result.stdout).not.toContain(`--deployment ${newerId}`);
  expect(result.code).toBe(1);
});

test("a failed wait succeeds when that exact deployment is active despite a newer build", async () => {
  const result = await runDeployment("ACTIVE");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Deployment became active");
  expect(result.stdout).not.toContain("Logs requested");
});
