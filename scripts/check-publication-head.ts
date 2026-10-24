import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
type RunGit = (args: string[]) => Promise<string>;

async function runGit(args: string[]) {
  try {
    return (await execute("git", args, { timeout: 15_000 })).stdout;
  } catch {
    // Git errors may contain credential-bearing remote URLs.
    throw new Error("Unable to verify publication head");
  }
}

export async function checkPublicationHead(
  testedSha: string,
  git: RunGit = runGit,
) {
  if (!/^[0-9a-f]{40}$/.test(testedSha)) throw new Error("Invalid tested SHA");
  const [checkout, remote] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["ls-remote", "origin", "refs/heads/master"]),
  ]);
  if (!/^[0-9a-f]{40}$/.test(checkout.trim()) || checkout.trim() !== testedSha)
    throw new Error("Checkout does not match tested SHA");
  const match = /^([0-9a-f]{40})\trefs\/heads\/master$/.exec(remote.trim());
  if (!match) throw new Error("Invalid current master response");
  return match[1] === testedSha;
}

if (import.meta.main)
  console.log(await checkPublicationHead(process.argv[2] ?? ""));
