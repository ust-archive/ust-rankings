import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import postgres from "postgres";

const USER_ID = "00000000-0000-4000-8000-000000000043";
const databaseUrl = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const authSecret = process.env.AUTH_SECRET;
const accountBrowserReady = Boolean(databaseUrl && authSecret);
let sql: ReturnType<typeof postgres> | undefined;

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
}

async function setUser(
  status: "onboarding" | "active",
  publicDisplayName: string,
) {
  if (!sql) throw new Error("Account browser database is not configured");
  await sql`DELETE FROM policy_acceptances WHERE user_id = ${USER_ID}`;
  await sql`
    INSERT INTO contribution_users (id, status, public_display_name)
    VALUES (${USER_ID}, ${status}, ${publicDisplayName})
    ON CONFLICT (id) DO UPDATE
    SET status = EXCLUDED.status,
        public_display_name = EXCLUDED.public_display_name,
        updated_at = now()
  `;
}

async function addSignedSession(context: BrowserContext) {
  if (!authSecret) throw new Error("AUTH_SECRET is not configured");
  const cookieName = "authjs.session-token";
  const value = await encode({
    token: {
      userId: USER_ID,
      displayName: "Browser Student",
      onboarded: false,
    },
    secret: authSecret,
    salt: cookieName,
  });
  await context.addCookies([
    {
      name: cookieName,
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("signed-out sign-in keeps safe returns, errors, and keyboard order", async ({
  page,
}) => {
  await page.goto(
    "/sign-in?r=%2Fcourses%2FCOMP%2F2000%3Fterm%3D2510&error=OAuthCallback",
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Sign-in could not be completed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue without signing in" }),
  ).toHaveAttribute("href", "/courses/COMP/2000?term=2510");

  const connect = page.getByRole("button", {
    name: "Student / Connect account",
  });
  await connect.focus();
  await expect(connect).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Staff / HKUST account" }),
  ).toBeFocused();

  await page.goto("/sign-in?r=%2F%2Fevil.example");
  await expect(
    page.getByRole("link", { name: "Continue without signing in" }),
  ).toHaveAttribute("href", "/");

  for (const alias of [
    "/%73ign-in",
    "/onboard%69ng",
    "/api/%61uth/callback/hkust-connect",
    "/auth/%63ontinue",
  ]) {
    await page.goto(`/sign-in?r=${encodeURIComponent(alias)}`);
    await expect(
      page.getByRole("link", { name: "Continue without signing in" }),
    ).toHaveAttribute("href", "/");
  }
});

test.describe("signed account routes", () => {
  test.skip(
    !accountBrowserReady,
    "requires ephemeral PostgreSQL and a test Auth.js secret",
  );

  test.beforeAll(() => {
    sql = postgres(databaseUrl as string, { max: 1 });
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM policy_acceptances WHERE user_id = ${USER_ID}`;
    await sql`DELETE FROM external_identities WHERE user_id = ${USER_ID}`;
    await sql`DELETE FROM contribution_users WHERE id = ${USER_ID}`;
    await sql.end();
  });

  test("onboarding exposes errors and completes by keyboard", async ({
    context,
    page,
  }) => {
    await setUser("onboarding", "Browser Student");
    await addSignedSession(context);
    await page.goto("/onboarding?r=%2Faccount&error=invalid-display-name");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Enter a valid Public Display Name" }),
    ).toBeVisible();

    const name = page.getByLabel("Public Display Name");
    await name.focus();
    await name.fill("Keyboard Student");
    await page.keyboard.press("Tab");
    const privacy = page.getByRole("checkbox", {
      name: /collection notice/,
    });
    await expect(privacy).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", {
        name: "Privacy and Community Policy",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const community = page.getByRole("checkbox", {
      name: /community rules/,
    });
    await expect(community).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Activate account" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText("active", { exact: true })).toBeVisible();
  });

  test("active account edits expose errors and save by keyboard", async ({
    context,
    page,
  }) => {
    await setUser("active", "Current Browser Name");
    await addSignedSession(context);
    await page.goto("/account?error=invalid-display-name");
    await expect(
      page.getByRole("alert").filter({ hasText: "invalid-display-name" }),
    ).toBeVisible();

    const name = page.getByLabel("Edit Public Display Name");
    await name.focus();
    await name.fill("Future Name");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Save account settings" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/account\?saved=1$/);
    await expect(page.getByRole("status")).toContainText(
      "Account settings saved",
    );
    await expect(page.getByText("Future Name", { exact: true })).toBeVisible();
  });

  test("account flow reflows at 320px with an accessible account entry", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/sign-in?error=OAuthCallback");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Sign-in could not be completed" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await setUser("onboarding", "Narrow Student");
    await addSignedSession(context);
    await page.goto("/onboarding?error=invalid-display-name");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Enter a valid Public Display Name" }),
    ).toBeVisible();
    await expect(page.getByLabel("Public Display Name")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await setUser("active", "Narrow Student");
    await page.goto("/auth/continue");
    await expect(page).toHaveURL(/\/rankings\/instructors$/);
    const account = page.getByRole("link", { name: "Account", exact: true });
    await account.focus();
    await expect(account).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/account$/);

    await page.goto("/account?error=invalid-display-name");
    await expect(
      page.getByRole("alert").filter({ hasText: "invalid-display-name" }),
    ).toBeVisible();
    const name = page.getByLabel("Edit Public Display Name");
    await name.fill("Narrow Name");
    await name.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/account\?saved=1$/);
    await expect(page.getByRole("status")).toContainText(
      "Account settings saved",
    );
    await expectNoHorizontalOverflow(page);
  });
});
