import { afterEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const secret = "correct-secret-with-enough-entropy";
const generation = "a".repeat(64);
const activation = {
  generation,
  indexUrl: `https://huggingface.co/datasets/ust-archive/ust-rankings/resolve/${"1".repeat(40)}/browser/${generation}/server-index.json.gz`,
  bytes: 1024,
  sha256: "b".repeat(64),
};

function request(body: unknown, authorization = `Bearer ${secret}`) {
  return new Request("https://example.test/api/server-index/activate", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.RANKINGS_REFRESH_SECRET;
});

test("authenticated activation accepts the staged generation contract", async () => {
  process.env.RANKINGS_REFRESH_SECRET = secret;
  const operation = vi.fn(async (value: typeof activation) => ({
    status: "activated" as const,
    generation: value.generation,
  }));
  const { createServerIndexActivationHandler } = await import(
    "@/app/api/server-index/activate/route"
  );
  const POST = createServerIndexActivationHandler(operation);

  const response = await POST(request(activation));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "activated",
    generation,
  });
  expect(operation).toHaveBeenCalledWith(activation);
});

test("activation rejects unauthenticated, malformed, oversized, and invalid requests", async () => {
  process.env.RANKINGS_REFRESH_SECRET = secret;
  const operation = vi.fn(async () => {
    const { InvalidServerIndexRequestError } = await import(
      "@/lib/server-index"
    );
    throw new InvalidServerIndexRequestError("Invalid generation");
  });
  const { createServerIndexActivationHandler } = await import(
    "@/app/api/server-index/activate/route"
  );
  const POST = createServerIndexActivationHandler(operation);

  expect((await POST(request(activation, "Bearer wrong"))).status).toBe(401);
  expect((await POST(request({ generation }))).status).toBe(400);
  expect(
    (
      await POST(
        new Request("https://example.test/api/server-index/activate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-length": "4097",
          },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(413);
  const invalid = await POST(request(activation));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: "Invalid generation" });
});

test("activation failure is bounded and does not expose the staged location", async () => {
  process.env.RANKINGS_REFRESH_SECRET = secret;
  const operation = vi.fn(async () => {
    const { ServerIndexActivationError } = await import("@/lib/server-index");
    throw new ServerIndexActivationError("integrity");
  });
  const { createServerIndexActivationHandler } = await import(
    "@/app/api/server-index/activate/route"
  );
  const response = await createServerIndexActivationHandler(operation)(
    request(activation),
  );
  const body = await response.json();

  expect(response.status).toBe(503);
  expect(body).toEqual({
    error:
      "Server Index activation failed; previous generation remains active.",
    failureClass: "integrity",
  });
  expect(JSON.stringify(body)).not.toContain(activation.indexUrl);
});
