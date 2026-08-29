import { expect, test } from "@playwright/test";

const courseOffering = (
  page: import("@playwright/test").Page,
  courseCode: string,
) =>
  page.getByRole("listitem").filter({
    has: page.getByRole("heading", { exact: true, name: courseCode }),
  });

const waitlistCard = (page: import("@playwright/test").Page) =>
  courseOffering(page, "WAIT 3000");

test("WL Compass calculates independent browser-only Course Plans", async ({
  page,
}) => {
  const requests: Array<{ postData: string | null; url: string }> = [];
  page.on("request", (request) =>
    requests.push({ postData: request.postData(), url: request.url() }),
  );
  await page.goto("/waitlist");

  const card = waitlistCard(page);
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Require L1" }),
  ).toHaveAttribute("aria-pressed", "false");

  await card.getByRole("button", { name: "Require L1" }).click();
  await expect(
    card.getByRole("button", { name: "Require L1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await card
    .getByRole("spinbutton", { name: "WL Position for WAIT 3000 L1" })
    .fill("5");
  await card.getByRole("button", { name: "Require T1" }).click();
  await card
    .getByRole("spinbutton", { name: "WL Position for WAIT 3000 T1" })
    .fill("3");

  const result = card.getByRole("region", { name: "WL Compass result" });
  await expect(result).toBeVisible();

  const math = courseOffering(page, "MATH 1000");
  await math.getByRole("button", { name: "Require L1" }).click();
  await math
    .getByRole("spinbutton", { name: "WL Position for MATH 1000 L1" })
    .fill("2");
  await expect(
    math.getByRole("region", { name: "WL Compass result" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Require L1" }),
  ).toHaveAttribute("aria-pressed", "true");

  const search = page.getByRole("searchbox", {
    name: "Search WL Compass Courses",
  });
  await search.fill("MATH");
  await expect(card).toHaveCount(0);
  await search.fill("");
  await expect(result).toBeVisible();
  await expect(
    math.getByRole("region", { name: "WL Compass result" }),
  ).toBeVisible();
  await expect(page.locator("#waitlist-wait-3000-summary-heading")).toHaveCount(
    1,
  );
  await expect(page.locator("#waitlist-math-1000-summary-heading")).toHaveCount(
    1,
  );
  expect(page.url()).not.toMatch(/[?&](position|classes)=/);
  expect(
    requests.some(
      ({ postData, url }) =>
        /queue.?position/i.test(url) || /queue.?position/i.test(postData ?? ""),
    ),
  ).toBe(false);
});

test("WL Compass search accepts compact Course Codes", async ({ page }) => {
  await page.goto("/waitlist");
  const search = page.getByRole("searchbox", {
    name: "Search WL Compass Courses",
  });
  await search.fill("WAIT3000");
  expect(new URL(page.url()).searchParams.get("q")).toBe("WAIT3000");
  await expect(waitlistCard(page)).toBeVisible();
  await expect(courseOffering(page, "MATH 1000")).toHaveCount(0);
});

test("WL Compass supports keyboard use at 390px without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/waitlist");
  const card = waitlistCard(page);
  await expect(card).toBeVisible();

  const require = card.getByRole("button", { name: "Require L1" });
  await require.focus();
  await page.keyboard.press("Enter");
  await expect(require).toHaveAttribute("aria-pressed", "true");

  const position = card.getByRole("spinbutton", {
    name: "WL Position for WAIT 3000 L1",
  });
  await position.focus();
  await page.keyboard.type("5");
  await expect(position).toHaveValue("5");
  await page.keyboard.press("Tab");

  const details = card.getByRole("button", {
    name: "More details for WAIT 3000 L1",
  });
  await expect(details).toBeFocused();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("WL Compass exposes unsupported sections and waits for valid positions", async ({
  page,
}) => {
  await page.goto("/waitlist");
  const comp = page.locator("[data-waitlist-course='COMP 2000']");
  const wait = waitlistCard(page);
  await expect(comp.getByRole("button", { name: "Require L1" })).toBeDisabled();
  await expect(comp.getByRole("checkbox")).toHaveCount(0);

  await expect(
    wait.getByRole("button", { name: "Calculate WL Compass" }),
  ).toHaveCount(0);
  await expect(
    wait.getByRole("region", { name: "WL Compass result" }),
  ).toHaveCount(0);
});

test("WL Compass retains plans through filtering and validates positions", async ({
  page,
}) => {
  await page.goto("/waitlist");
  const card = waitlistCard(page);
  await card.getByRole("button", { name: "Require L1" }).click();
  const position = card.getByRole("spinbutton", {
    name: "WL Position for WAIT 3000 L1",
  });
  await position.fill("9");
  await expect(position).toHaveAttribute("aria-invalid", "true");
  await expect(
    card.getByRole("button", { name: "Calculate WL Compass" }),
  ).toHaveCount(0);
  expect(page.url()).not.toContain("9");

  await position.fill("5");
  await expect(
    card.getByRole("region", { name: "WL Compass result" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "Search WL Compass Courses",
  });
  await search.fill("MATH");
  await expect(card).toHaveCount(0);
  await search.fill("WAIT");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Require L1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(position).toHaveValue("5");

  await page.reload();
  const freshCard = waitlistCard(page);
  await expect(
    freshCard.getByRole("button", { name: "Require L1" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    freshCard.getByRole("spinbutton", {
      name: "WL Position for WAIT 3000 L1",
    }),
  ).toHaveCount(0);
});
