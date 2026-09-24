import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DatabaseContext = {
  caller:
    | "course"
    | "course-term"
    | "course-section"
    | "instructor"
    | "review"
    | "account"
    | "account.header"
    | "auth"
    | "attachments"
    | "operator"
    | "unknown";
  authentication?: "authenticated" | "anonymous" | "unknown";
  requestClass?:
    | "document"
    | "explicit-prefetch"
    | "rsc-unknown"
    | "action-api"
    | "non-http"
    | "unknown";
};
type Operation = DatabaseContext & {
  operation: string;
  intent: "read" | "write";
};
const processId = randomUUID();
function deploymentId() {
  try {
    const value =
      process.env.DEPLOYMENT_ID ??
      readFileSync(
        join(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next", "BUILD_ID"),
        "utf8",
      ).trim();
    return /^[\w.-]{1,100}$/.test(value) ? value : "unknown";
  } catch {
    return "unknown";
  }
}
const deployment = deploymentId();

function errorCategory(error: unknown): string {
  try {
    const visited = new Set<unknown>();
    while (error && typeof error === "object" && !visited.has(error)) {
      visited.add(error);
      if ("code" in error && error.code === "53000") return "quota-exceeded";
      error = "cause" in error ? error.cause : undefined;
    }
  } catch {
    /* Some thrown values cannot safely be inspected. */
  }
  return "other";
}

/** Counts semantic operation attempts, not SQL statements or billing units. */
export async function observeDatabaseOperation<T>(
  context: Operation,
  work: () => PromiseLike<T>,
): Promise<T> {
  const base = {
    event: "database-operation",
    version: 1,
    operationId: randomUUID(),
    processId,
    deployment,
    operation: context.operation,
    caller: context.caller,
    intent: context.intent,
    authentication: context.authentication ?? "unknown",
    requestClass: context.requestClass ?? "unknown",
  };
  function emit(fields: Record<string, unknown>) {
    try {
      console.log(
        JSON.stringify({
          ...base,
          timestamp: new Date().toISOString(),
          ...fields,
        }),
      );
    } catch {
      /* Observability must never change the operation's result. */
    }
  }
  const started = performance.now();
  emit({ phase: "attempt" });
  try {
    const result = await work();
    emit({
      phase: "complete",
      outcome: "success",
      durationMs: performance.now() - started,
    });
    return result;
  } catch (error) {
    emit({
      phase: "complete",
      outcome: "error",
      errorCategory: errorCategory(error),
      durationMs: performance.now() - started,
    });
    throw error;
  }
}

type AsyncKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => PromiseLike<unknown>
    ? K
    : never;
}[keyof T];

/** Wrap owned service methods once; repositories and internal calls remain unwrapped. */
export function observeDatabaseService<T extends object>(
  service: T,
  name: string,
  methods: Record<AsyncKeys<T>, "read" | "write">,
  capture: () => Promise<DatabaseContext>,
): T {
  const observed = { ...service };
  for (const [method, intent] of Object.entries(methods)) {
    const work = service[method as keyof T] as (
      ...args: unknown[]
    ) => PromiseLike<unknown>;
    Object.assign(observed, {
      [method]: async (...args: unknown[]) => {
        const context = await Promise.resolve()
          .then(capture)
          .catch(() => ({ caller: "unknown" as const }));
        return observeDatabaseOperation(
          {
            ...context,
            operation: `${name}.${method}`,
            intent: intent as "read" | "write",
          },
          () => work.apply(service, args),
        );
      },
    });
  }
  return observed;
}
