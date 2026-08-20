import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccountRow } from "@/lib/contributions/accounts";

const USER_ID = "00000000-0000-4000-8000-000000000043";
let authenticatedId: string | undefined = USER_ID;
let currentUser: AccountRow | undefined = {
  id: USER_ID,
  status: "onboarding",
  publicDisplayName: "Student Name",
};

mock.module("@/lib/auth/user", () => ({
  authenticatedUserId: async () => authenticatedId,
}));
mock.module("@/lib/contributions/postgres", () => ({
  getAccountService: () => ({ getUser: async () => currentUser }),
}));
mock.module("@/app/account/actions", () => ({
  completeOnboarding: async () => {},
  updateAccount: async () => {},
  endSession: async () => {},
}));

test("onboarding confirms Public Display Name and both current policies", async () => {
  currentUser = {
    id: USER_ID,
    status: "onboarding",
    publicDisplayName: "Student Name",
  };
  const { default: OnboardingPage } = await import("@/app/onboarding/page");
  const markup = renderToStaticMarkup(
    await OnboardingPage({ searchParams: Promise.resolve({ r: "/account" }) }),
  );
  expect(markup).toContain("Complete onboarding");
  expect(markup).toContain("Public Display Name");
  expect(markup).toContain('name="acceptPrivacy"');
  expect(markup).toContain('name="acceptCommunity"');
  expect(markup).toContain("Account writes remain disabled");
});

test("account reflects current database status and only active Users may edit", async () => {
  const { default: AccountPage } = await import("@/app/account/page");
  currentUser = {
    id: USER_ID,
    status: "active",
    publicDisplayName: "Current Name",
  };
  const active = renderToStaticMarkup(
    await AccountPage({ searchParams: Promise.resolve({}) }),
  );
  expect(active).toContain("Save account settings");
  expect(active).toContain("Current Name");

  currentUser = { ...currentUser, status: "suspended" };
  const suspended = renderToStaticMarkup(
    await AccountPage({ searchParams: Promise.resolve({}) }),
  );
  expect(suspended).toContain("Current database status blocks");
  expect(suspended).not.toContain("Save account settings");
});

test("signed-out account routes return through the safe sign-in path", async () => {
  authenticatedId = undefined;
  const { default: AccountPage } = await import("@/app/account/page");
  try {
    await AccountPage({ searchParams: Promise.resolve({}) });
    throw new Error("Account route did not redirect");
  } catch (error) {
    expect(String((error as { digest?: string }).digest)).toContain(
      "NEXT_REDIRECT;replace;/sign-in?r=%2Faccount;307;",
    );
  } finally {
    authenticatedId = USER_ID;
  }
});
