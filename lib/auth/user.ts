import "server-only";
import { headers } from "next/headers";
import { getToken } from "next-auth/jwt";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function authenticatedUserId(request?: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const requestLike = request ?? { headers: await headers() };
  const token = await getToken({
    req: requestLike,
    secret,
    secureCookie:
      process.env.NODE_ENV === "production" ||
      process.env.AUTH_URL?.startsWith("https://") === true,
  });
  return typeof token?.userId === "string" && UUID.test(token.userId)
    ? token.userId
    : undefined;
}
