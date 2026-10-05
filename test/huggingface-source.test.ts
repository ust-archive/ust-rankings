import { spawnSync } from "node:child_process";
import { afterEach, expect, test, vi } from "vitest";
import {
  checkAuthentication,
  resolveRevision,
} from "../scripts/huggingface-source.ts";

const token = "hf_test_secret_not_for_logs";
const revision = "a".repeat(40);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockResponse(status: number, body: string) {
  vi.stubEnv("HF_TOKEN", token);
  const request = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", request);
  return request;
}

test("authentication checks the identity endpoint using the token", async () => {
  const request = mockResponse(
    200,
    JSON.stringify({ name: "ust-archive-bot" }),
  );
  await checkAuthentication();
  expect(request).toHaveBeenCalledWith(
    "https://huggingface.co/api/whoami-v2",
    expect.objectContaining({ headers: { Authorization: `Bearer ${token}` } }),
  );
});

test.each([undefined, "", "   "])(
  "empty tokens fail before making a request: %j",
  async (value) => {
    const request = mockResponse(200, "{}");
    vi.stubEnv("HF_TOKEN", value);
    await expect(checkAuthentication()).rejects.toThrow(
      "HF_TOKEN is missing or empty",
    );
    expect(request).not.toHaveBeenCalled();
  },
);

test("invalid authentication reports HTTP 401 and the secret to replace", async () => {
  mockResponse(401, token);
  await expect(checkAuthentication()).rejects.toThrow(
    "Hugging Face authentication: HTTP 401. Check that the HF_TOKEN secret is valid and has not expired or been revoked.",
  );
});

test("revision resolution returns the immutable commit SHA", async () => {
  const request = mockResponse(200, JSON.stringify({ sha: revision }));
  await expect(resolveRevision("ust-archive/sfq")).resolves.toBe(revision);
  expect(request).toHaveBeenCalledWith(
    "https://huggingface.co/api/datasets/ust-archive/sfq/revision/main",
    expect.any(Object),
  );
});

test.each([401, 403, 404, 503])(
  "revision failures identify the dataset and HTTP %i without response bodies",
  async (status) => {
    mockResponse(status, token);
    const error = await resolveRevision("ust-archive/sfq").catch(
      (error: Error) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      `dataset ust-archive/sfq revision: HTTP ${status}.`,
    );
    expect((error as Error).message).not.toContain(token);
  },
);

test.each(["not JSON", "null", "{}", JSON.stringify({ sha: token })])(
  "invalid revision responses fail without echoing their contents: %j",
  async (body) => {
    mockResponse(200, body);
    const error = await resolveRevision("ust-archive/schedule").catch(
      (error: Error) => error,
    );
    expect((error as Error).message).toContain(
      "dataset ust-archive/schedule revision:",
    );
    expect((error as Error).message).not.toContain(token);
  },
);

test("transport errors suppress underlying request details", async () => {
  const request = mockResponse(200, "{}");
  request.mockRejectedValue(new Error(`request headers contained ${token}`));
  await expect(resolveRevision("ust-archive/catalog")).rejects.toThrow(
    "Hugging Face dataset ust-archive/catalog revision: request failed or timed out.",
  );
});

test.each([200, 401])(
  "revision CLI keeps stdout usable in shell substitutions for HTTP %i",
  (status) => {
    const responseBody =
      status === 200 ? JSON.stringify({ sha: revision }) : token;
    const preload = `globalThis.fetch = async () => new Response(${JSON.stringify(responseBody)}, { status: ${status} });`;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`,
        "scripts/huggingface-source.ts",
        "revision",
        "ust-archive/sfq",
      ],
      { encoding: "utf8", env: { ...process.env, HF_TOKEN: token } },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status === 200 ? 0 : 1);
    expect(result.stdout).toBe(status === 200 ? `${revision}\n` : "");
    if (status === 200) expect(result.stderr).toBe("");
    else
      expect(result.stderr).toContain(
        "dataset ust-archive/sfq revision: HTTP 401.",
      );
    expect(result.stderr).not.toContain(token);
  },
);
