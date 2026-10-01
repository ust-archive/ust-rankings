import { headers } from "next/headers";
import { userAgentFromString } from "next/server";
import type { DatabaseContext } from "./database-telemetry";

/** Never infer a route or user identity from arbitrary request headers. */
export async function databaseRequestContext(
  context: DatabaseContext,
): Promise<DatabaseContext> {
  try {
    const request = await headers();
    const agent = request.get("user-agent")?.slice(0, 1024);
    const parsed = agent ? userAgentFromString(agent) : undefined;
    // ponytail: declared agents are spoofable; verify bot identity separately before access policy changes.
    const agentClass: DatabaseContext["agentClass"] = !agent
      ? "missing"
      : parsed?.isBot || /bot\b|crawler|spider|meta-externalagent/i.test(agent)
        ? "declared-bot"
        : parsed?.browser.name
          ? "browser-like"
          : "other";
    const site = request.get("sec-fetch-site");
    const fetchSite: DatabaseContext["fetchSite"] =
      site === null
        ? "missing"
        : site === "same-origin" ||
            site === "same-site" ||
            site === "cross-site" ||
            site === "none"
          ? site
          : "unknown";
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
    return { ...context, requestClass, agentClass, fetchSite };
  } catch {
    return {
      ...context,
      requestClass: "unknown",
      agentClass: "unknown",
      fetchSite: "unknown",
    };
  }
}
