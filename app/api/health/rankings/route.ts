import { getRankingsHealth } from "@/lib/rankings/server";

export async function GET() {
  const health = await getRankingsHealth();
  return Response.json(health, {
    status: health.status === "unavailable" ? 503 : 200,
    headers: { "cache-control": "public, max-age=60" },
  });
}
