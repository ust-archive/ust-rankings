import { expect, test, vi } from "vitest";
import { HKUST_PROVIDER_ID } from "@/lib/auth/policy";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("@/auth", () => ({ signIn }));

test("login starts institutional OAuth directly and preserves a safe return path", async () => {
  const { GET } = await import("@/app/auth/login/route");
  const response = await GET(
    new Request("http://localhost:3000/auth/login?r=%2Faccount"),
  );

  expect(signIn).toHaveBeenCalledWith(HKUST_PROVIDER_ID, {
    redirectTo: "/auth/continue?r=%2Faccount",
  });
  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/account",
  );
});
