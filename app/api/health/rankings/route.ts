import { getRankingsHealth } from "@/lib/rankings/server";

export function createRankingHealthHandler(readHealth = getRankingsHealth) {
  return async function GET() {
    const health = await readHealth();
    return Response.json(health, {
      status: health.status === "unavailable" ? 503 : 200,
      headers: { "cache-control": "public, max-age=60" },
    });
  };
}

export const GET = createRankingHealthHandler();
