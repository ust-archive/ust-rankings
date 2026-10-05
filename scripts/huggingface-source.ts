async function authenticatedRequest(path: string, context: string) {
  const token = process.env.HF_TOKEN?.trim();
  if (!token) throw new Error(`${context}: HF_TOKEN is missing or empty.`);

  let response: Response;
  try {
    response = await fetch(`https://huggingface.co/api/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`${context}: request failed or timed out.`);
  }

  if (!response.ok) {
    const advice =
      response.status === 401
        ? "Check that the HF_TOKEN secret is valid and has not expired or been revoked."
        : response.status === 403
          ? "Check the HF_TOKEN permissions and the token owner's repository access."
          : response.status === 404
            ? "Check the repository name and the token owner's repository access."
            : "Check Hugging Face availability and retry.";
    throw new Error(`${context}: HTTP ${response.status}. ${advice}`);
  }
  return response;
}

export async function checkAuthentication() {
  await authenticatedRequest("whoami-v2", "Hugging Face authentication");
}

export async function resolveRevision(repository: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error(
      "Expected a Hugging Face dataset repository in owner/name format.",
    );
  const context = `Hugging Face dataset ${repository} revision`;
  const response = await authenticatedRequest(
    `datasets/${repository}/revision/main`,
    context,
  );
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`${context}: invalid JSON response.`);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("sha" in value) ||
    typeof value.sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sha)
  )
    throw new Error(`${context}: response did not contain a valid commit SHA.`);
  return value.sha;
}

if (import.meta.main) {
  try {
    const [command, repository] = process.argv.slice(2);
    if (command === "auth" && !repository) {
      await checkAuthentication();
      console.log("Hugging Face authentication verified.");
    } else if (command === "revision" && repository) {
      console.log(await resolveRevision(repository));
    } else {
      throw new Error(
        "Usage: node scripts/huggingface-source.ts auth | revision owner/name",
      );
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
