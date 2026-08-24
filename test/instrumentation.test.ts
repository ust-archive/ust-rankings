import { afterEach, expect, test, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  initializeServerIndex: vi.fn<() => Promise<unknown>>(),
  refreshRankings: vi.fn(async () => ({ status: "current" as const })),
  refreshSchedule: vi.fn(async () => ({ status: "current" as const })),
}));

vi.mock("@/lib/server-index", () => ({
  initializeServerIndex: runtime.initializeServerIndex,
}));
vi.mock("@/lib/rankings/server", () => ({
  refreshRankings: runtime.refreshRankings,
}));
vi.mock("@/lib/rankings/runtime", () => ({
  productionRankingRefreshDependencies: () => ({}),
}));
vi.mock("@/lib/schedule/server", () => ({
  refreshSchedule: runtime.refreshSchedule,
}));
vi.mock("@/lib/schedule/runtime", () => ({
  productionScheduleRefreshDependencies: () => ({}),
}));

const originalEnvironment = {
  NEXT_RUNTIME: process.env.NEXT_RUNTIME,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PHASE: process.env.NEXT_PHASE,
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
  runtime.initializeServerIndex.mockReset();
  runtime.refreshRankings.mockClear();
  runtime.refreshSchedule.mockClear();
});

test("production registration waits for Server Index recovery before legacy refresh work", async () => {
  Object.assign(process.env, {
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
  });
  delete process.env.NEXT_PHASE;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.initializeServerIndex.mockReturnValue(held);
  vi.spyOn(globalThis, "setInterval").mockImplementation(
    () => ({}) as NodeJS.Timeout,
  );
  const { register } = await import("@/instrumentation");

  const registering = register();
  await vi.waitFor(() =>
    expect(runtime.initializeServerIndex).toHaveBeenCalledOnce(),
  );
  expect(runtime.refreshRankings).not.toHaveBeenCalled();
  expect(runtime.refreshSchedule).not.toHaveBeenCalled();

  release();
  await registering;
  await vi.waitFor(() =>
    expect(runtime.refreshSchedule).toHaveBeenCalledOnce(),
  );
  expect(runtime.refreshRankings).toHaveBeenCalledOnce();
});
