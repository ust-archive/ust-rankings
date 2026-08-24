import { afterEach, expect, test, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  initializeServerIndex: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/lib/server-index", () => ({
  initializeServerIndex: runtime.initializeServerIndex,
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
  runtime.initializeServerIndex.mockReset();
});

test("production registration starts Server Index recovery without blocking startup", async () => {
  Object.assign(process.env, {
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
  });
  delete process.env.NEXT_PHASE;
  runtime.initializeServerIndex.mockReturnValue(new Promise(() => {}));
  const { register } = await import("@/instrumentation");

  await register();

  expect(runtime.initializeServerIndex).toHaveBeenCalledOnce();
});
