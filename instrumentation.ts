export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { initializeServerIndex } = await import("@/lib/server-index");
  void initializeServerIndex().catch(() => undefined);
}
