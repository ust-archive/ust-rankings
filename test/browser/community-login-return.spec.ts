import { expect, test } from "@playwright/test";

for (const activation of ["click", "keyboard"] as const) {
  test(`Community Login preserves the current path, query and fragment on ${activation}`, async ({
    page,
    context,
  }) => {
    // Intercept the login endpoint itself, so OAuth is never contacted.
    await context.route(
      (url) => url.pathname === "/auth/login",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "Local login interception",
        }),
    );
    await page.goto(
      `${process.env.TEST_LOGIN_DETAIL_PATH ?? "/courses/COMP/2000/2510/L1"}?order=recent#reviews`,
    );
    const login = page
      .getByRole("region", { name: "Rankings and Community" })
      .getByRole("link", { name: /Login/ })
      .first();
    await expect(login).toBeVisible();
    await login.dispatchEvent("contextmenu");
    await expect(login).toHaveAttribute("href", /order%3Drecent%23reviews/);
    // Return state must be captured at activation, including client-only URL changes.
    const expected = await page.evaluate(() => {
      history.replaceState(
        history.state,
        "",
        `${location.pathname}?order=oldest#reviews`,
      );
      return `${location.pathname}${location.search}${location.hash}`;
    });
    const request = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/auth/login",
    );
    if (activation === "keyboard") {
      await login.focus();
      await login.press("Enter");
    } else await login.click();
    const loginUrl = new URL((await request).url());
    expect(loginUrl.searchParams.get("r")).toBe(expected);
  });
}
