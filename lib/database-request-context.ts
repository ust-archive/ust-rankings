import { headers } from "next/headers";
import type { DatabaseContext } from "./database-telemetry";

/** Never infer a route or user identity from arbitrary request headers. */
export async function databaseRequestContext(
  context: DatabaseContext,
): Promise<DatabaseContext> {
  try {
    const request = await headers();
    const requestClass =
      request.has("next-router-prefetch") ||
      request.get("purpose") === "prefetch" ||
      request.get("sec-purpose")?.includes("prefetch")
        ? "explicit-prefetch"
        : request.has("next-action")
          ? "action-api"
          : request.get("rsc") === "1"
            ? "rsc-unknown"
            : request.get("sec-fetch-dest") === "document"
              ? "document"
              : (context.requestClass ?? "unknown");
    return { ...context, requestClass };
  } catch {
    return { ...context, requestClass: "unknown" };
  }
}
