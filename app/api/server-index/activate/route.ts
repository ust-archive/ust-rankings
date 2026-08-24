import { createHash, timingSafeEqual } from "node:crypto";
import type { ServerIndexActivation } from "@/lib/server-index";

export const maxDuration = 60;

type ActivationOperation = (request: ServerIndexActivation) => Promise<{
  status: "activated" | "current";
  generation: string;
}>;

const MAX_REQUEST_BYTES = 4096;

class RequestTooLargeError extends Error {}

async function requestJson(request: Request) {
  if (!request.body) throw new SyntaxError("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError();
    }
    chunks.push(value);
  }
  return JSON.parse(
    Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      bytes,
    ).toString("utf8"),
  ) as unknown;
}

function authenticated(request: Request) {
  const secret = process.env.RANKINGS_REFRESH_SECRET ?? process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer "))
    return false;
  return timingSafeEqual(
    createHash("sha256").update(secret).digest(),
    createHash("sha256").update(authorization.slice("Bearer ".length)).digest(),
  );
}

export function createServerIndexActivationHandler(
  operation: ActivationOperation,
) {
  return async function POST(request: Request) {
    if (!authenticated(request))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
      return Response.json({ error: "Request is too large." }, { status: 413 });
    let body: unknown;
    try {
      body = await requestJson(request);
    } catch (error) {
      return error instanceof RequestTooLargeError
        ? Response.json({ error: "Request is too large." }, { status: 413 })
        : Response.json({ error: "Invalid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json(
        { error: "Invalid activation request." },
        { status: 400 },
      );
    const value = body as Record<string, unknown>;
    if (
      typeof value.generation !== "string" ||
      typeof value.indexUrl !== "string" ||
      typeof value.bytes !== "number" ||
      typeof value.sha256 !== "string"
    )
      return Response.json(
        { error: "Invalid activation request." },
        { status: 400 },
      );
    try {
      return Response.json(
        await operation({
          generation: value.generation,
          indexUrl: value.indexUrl,
          bytes: value.bytes,
          sha256: value.sha256,
        }),
      );
    } catch (error) {
      const { InvalidServerIndexRequestError, ServerIndexActivationError } =
        await import("@/lib/server-index");
      if (error instanceof InvalidServerIndexRequestError)
        return Response.json({ error: error.message }, { status: 400 });
      if (error instanceof ServerIndexActivationError)
        return Response.json(
          { error: error.message, failureClass: error.failureClass },
          { status: 503 },
        );
      console.error("server index activation failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return Response.json(
        { error: "Server Index activation failed." },
        { status: 503 },
      );
    }
  };
}

export function createServerIndexStatusHandler(
  operation: () => Promise<{ generation: string }>,
) {
  return async function GET(request: Request) {
    if (!authenticated(request))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      return Response.json(await operation());
    } catch {
      return Response.json(
        { error: "Server Index unavailable." },
        { status: 503 },
      );
    }
  };
}

async function productionActivation(request: ServerIndexActivation) {
  const { activateServerIndex } = await import("@/lib/server-index");
  return activateServerIndex(request);
}

async function productionStatus() {
  const { currentServerIndex } = await import("@/lib/server-index");
  const index = await currentServerIndex();
  if (!index) throw new Error("Server Index unavailable");
  return { generation: index.generation };
}

export const POST = createServerIndexActivationHandler(productionActivation);
export const GET = createServerIndexStatusHandler(productionStatus);
