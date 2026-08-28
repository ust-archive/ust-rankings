import { expect, test } from "@playwright/test";

const waitlistCard = (page: import("@playwright/test").Page) =>
  page.locator("[data-waitlist-course='WAIT 3000']");

test("WL Compass calculates independent browser-only Course Plans", async ({
  page,
}) => {
  const requests: Array<{ postData: string | null; url: string }> = [];
  page.on("request", (request) =>
    requests.push({ postData: request.postData(), url: request.url() }),
  );
  await page.goto("/waitlist");

  await expect(
    page.getByRole("heading", { level: 1, name: "WL Compass" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "WL Compass" }),
  ).toBeVisible();
  await expect(page.getByText(/2025-26 Fall ·/)).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search WL Compass Courses" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Term" })).toHaveCount(0);

  const card = waitlistCard(page);
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("heading", { level: 2, name: "WAIT 3000" }),
  ).toBeVisible();
  await expect(
    card.getByRole("columnheader", { name: "Section" }),
  ).toBeVisible();
  await expect(
    card.getByRole("columnheader", { name: "Position" }),
  ).toBeVisible();
  await expect(card.locator("tbody > :not(tr)")).toHaveCount(0);
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
  await expect(result).toContainText(/The clearance rate/i);
  await expect(result.getByText("Details")).toBeVisible();
  await expect(result.getByText("Evidence and Smoothing")).toBeVisible();
  await expect(result.getByText("Per-Section Evidence")).toBeVisible();
  await expect(result.getByText("Exact Historical Samples")).toBeVisible();
  await expect(result.getByText("Fuzzy Historical Samples")).toBeVisible();
  await expect(result.getByText("Prior Influence")).toBeVisible();
  await expect(result.getByText("Joint Outcome")).toBeVisible();
  await expect(
    result.getByRole("heading", { level: 4, name: "Timing" }),
  ).toBeVisible();
  await expect(result.getByText("Enrol Starts")).toBeVisible();
  await expect(result.getByText("Enrol Ends")).toBeVisible();
  await expect(result.getByText("Source")).toHaveCount(0);
  await expect(result.getByText("Joint Clearance Model")).toHaveCount(0);
  await expect(result.getByText("Historical Waitlist Records")).toHaveCount(0);
  await expect(
    result.getByRole("link", { name: "Registry Calendar" }),
  ).toHaveCount(0);
  await expect(result.getByText(/joint-baseline-v\d+/)).toHaveCount(0);
  await expect(
    result.getByText(/canonical\/class_records\.parquet/),
  ).toHaveCount(0);
  await expect(
    result.getByText(/This estimate uses comparable historical queues/),
  ).toHaveCount(0);
  await expect(
    result.getByRole("button", { name: /How this was read/ }),
  ).toHaveCount(0);

  const math = page.locator("[data-waitlist-course='MATH 1000']");
  await expect(
    math.getByRole("heading", { level: 2, name: "MATH 1000" }),
  ).toBeVisible();
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
  await expect(
    comp.getByRole("heading", { level: 2, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(
    comp.getByText(/No wait is currently reported/).first(),
  ).toBeVisible();
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
    card.getByText(/cannot exceed the current wait of 8/),
  ).toHaveCount(0);
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
