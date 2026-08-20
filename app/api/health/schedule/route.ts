import { getScheduleHealth } from "@/lib/schedule/server";

export function createScheduleHealthHandler(readHealth = getScheduleHealth) {
  return async function GET() {
    const health = await readHealth();
    return Response.json(health, {
      status: health.status === "unavailable" ? 503 : 200,
      headers: { "cache-control": "public, max-age=60" },
    });
  };
}

export const GET = createScheduleHealthHandler();
