export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const refresh = async () => {
    if (!process.env.RANKINGS_SEED_DIR) {
      const { refreshRankings } = await import("./lib/rankings/server");
      const { productionRankingRefreshDependencies } = await import(
        "./lib/rankings/runtime"
      );
      await refreshRankings({}, productionRankingRefreshDependencies()).catch(
        () => undefined,
      );
    }
    if (!process.env.SCHEDULE_SEED_DIR) {
      const { refreshSchedule } = await import("./lib/schedule/server");
      const { productionScheduleRefreshDependencies } = await import(
        "./lib/schedule/runtime"
      );
      await refreshSchedule({}, productionScheduleRefreshDependencies()).catch(
        () => undefined,
      );
    }
  };
  void refresh();
  setInterval(
    () => {
      void refresh();
    },
    24 * 60 * 60 * 1000,
  );
}
