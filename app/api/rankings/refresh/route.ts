import { createHash, timingSafeEqual } from "node:crypto";

export const maxDuration = 300;

function authenticated(request: Request) {
  const secret = process.env.RANKINGS_REFRESH_SECRET ?? process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer "))
    return false;
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256")
    .update(authorization.slice("Bearer ".length))
    .digest();
  return timingSafeEqual(actual, expected);
}

async function handle(request: Request, sha?: string) {
  if (!authenticated(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { refreshRankings } = await import("@/lib/rankings/server");
  const { productionRankingRefreshDependencies } = await import(
    "@/lib/rankings/runtime"
  );
  try {
    const result = await refreshRankings(
      { sha },
      productionRankingRefreshDependencies(),
    );
    return Response.json(result, {
      status: result.status === "busy" ? 409 : 200,
    });
  } catch (error) {
    const { InvalidRankingsQueryError, RankingsRefreshError } = await import(
      "@/lib/rankings/server"
    );
    if (error instanceof InvalidRankingsQueryError)
      return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof RankingsRefreshError)
      return Response.json(
        { error: error.message, failureClass: error.failureClass },
        { status: 503 },
      );
    console.error("ranking refresh failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return Response.json(
      { error: "Rankings refresh failed." },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  if (!authenticated(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return Response.json({ error: "Request is too large." }, { status: 413 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const sha =
    typeof body === "object" && body !== null && "sha" in body
      ? (body as { sha?: unknown }).sha
      : undefined;
  if (sha !== undefined && typeof sha !== "string")
    return Response.json({ error: "Invalid commit SHA." }, { status: 400 });
  return handle(request, sha);
}
