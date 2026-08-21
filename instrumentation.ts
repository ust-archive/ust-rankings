export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.RANKINGS_SEED_DIR) return;
  const { refreshRankings } = await import("./lib/rankings/server");
  const { productionRankingRefreshDependencies } = await import(
    "./lib/rankings/runtime"
  );
  const refresh = () =>
    refreshRankings({}, productionRankingRefreshDependencies()).catch(
      () => undefined,
    );
  void refresh();
  setInterval(refresh, 24 * 60 * 60 * 1000);
}
