import { isBot } from "isbot";
import { headers } from "next/headers";
import { userAgentFromString } from "next/server";
import {
  type DatabaseContext,
  observeCommunityReadDecision,
} from "./database-telemetry";

/** Never infer a route or user identity from arbitrary request headers. */
export async function databaseRequestContext(
  context: DatabaseContext,
): Promise<DatabaseContext> {
  try {
    const request = await headers();
    const agent = request.get("user-agent")?.slice(0, 1024);
    const parsed = agent ? userAgentFromString(agent) : undefined;
    // ponytail: agents are spoofable; add caching/rate limits if disguised traffic keeps compute active.
    // Keep the previous classifier during rollout for a same-request comparison.
    const previousAgentClass: DatabaseContext["agentClass"] = !agent
      ? "missing"
      : parsed?.isBot || /bot\b|crawler|spider|meta-externalagent/i.test(agent)
        ? "declared-bot"
        : parsed?.browser.name
          ? "browser-like"
          : "other";
    const agentClass = !agent
      ? "missing"
      : isBot(agent)
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
    return {
      ...context,
      requestClass,
      agentClass,
      previousAgentClass,
      fetchSite,
    };
  } catch {
    return {
      ...context,
      requestClass: "unknown",
      agentClass: "unknown",
      previousAgentClass: "unknown",
      fetchSite: "unknown",
    };
  }
}

/** Page loaders only: never applies to contribution writes or individual Review URLs. */
export async function skipBotCommunityRead(
  caller: DatabaseContext["caller"],
  operation: "reviews.listReviews" | "signals.readSignals",
) {
  const context = await databaseRequestContext({ caller });
  const skipped = context.agentClass === "declared-bot";
  observeCommunityReadDecision(context, operation, skipped);
  return skipped;
}
