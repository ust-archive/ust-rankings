import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

// Initialize Redis
const redis = Redis.fromEnv();

export const GET = async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const { id } = await context.params;

  const result =
    (await redis.get<{
      [unified: string]: number;
    }>(`reaction.${id}`)) ?? {};

  return new NextResponse(JSON.stringify(result), { status: 200 });
};

export const POST = async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const { id } = await context.params;
  const { unified, delta } = (await request.json()) as {
    unified: string;
    delta: number;
  };

  const result =
    (await redis.get<{
      [unified: string]: number;
    }>(`reaction.${id}`)) ?? {};
  result[unified] = (result[unified] || 0) + delta;
  if (result[unified] <= 0) {
    delete result[unified];
  }
  await redis.set(`reaction.${id}`, result);

  return new NextResponse("OK", { status: 200 });
};
