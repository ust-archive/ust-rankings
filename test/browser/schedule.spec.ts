import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("Schedule planner state stays shareable and usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedule?term=2510");

  const search = page.getByRole("searchbox", { name: "Search Schedule" });
  await search.fill("COMP");
  // The original Schedule searches while typing, without a submit step.
  await expect(page).toHaveURL(/q=COMP/);
  const classTable = page.getByRole("region", { name: "COMP 2000 Classes" });
  await classTable.focus();
  await expect(classTable).toBeFocused();

  await page.getByRole("button", { name: /^Add / }).first().click();
  await expect(page).toHaveURL(/class=1001/);
  await expect(page).not.toHaveURL(/view=cart/);
  await page.getByRole("tab", { name: "Shopping Cart" }).click();
  await expect(page.getByRole("tab", { name: "Shopping Cart" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Selected Classes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download calendar" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Import from SIS" }).click();
  const addClasses = page.getByRole("button", { name: "Submit!" });
  const sisText = page.getByRole("textbox", { name: "SIS page text" });
  const emptyImport = page.getByText(
    "No Class Numbers were found in the pasted SIS text.",
  );
  await addClasses.click();
  await expect(emptyImport).toBeVisible();
  await sisText.fill("LEC (2001)");
  await expect(emptyImport).toHaveCount(0);
  await addClasses.click();
  await expect(page).toHaveURL(/class=1001/);
  await expect(page).toHaveURL(/class=2001/);
  await expect(page.getByRole("tab", { name: "Shopping Cart" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("planner resolves selections outside the search and downloads the pinned meetings", async ({
  page,
}) => {
  await page.goto(
    "/schedule?term=2510&q=no-matching-course&class=1001&view=cart",
  );
  await expect(
    page.getByRole("heading", { name: "COMP 2000", exact: true }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download calendar" }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("ust-schedule.ics");
  const path = await file.path();
  expect(path).toBeTruthy();
  const body = await readFile(path as string, "utf8");
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("COMP 2000 L1");
  expect(body).toContain("DTSTART:20250903T030000Z");
  expect(body.replace(/\r\n[ \t]/g, "")).toContain(
    "EXDATE:20251001T030000Z,20251029T030000Z",
  );
  await expect(page.getByText(/Calendar downloaded/)).toHaveCount(0);
});

test("unknown Terms clear selections and valid Classes recover on a later navigation", async ({
  page,
}) => {
  await page.goto("/schedule?term=9999&class=1001&view=cart");
  await expect(page.getByText(/Unknown Term Code/)).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Shopping Cart", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download calendar" }),
  ).toBeDisabled();
  await page.goto("/schedule?term=2510&class=1001&view=cart");
  await expect(page.getByRole("tab", { name: "Shopping Cart" })).toBeVisible();
});

test("Schedule unavailable and invalid URL notices remain independent", async ({
  page,
}) => {
  await page.route("**/schedule-courses.parquet", (route) => route.abort());
  await page.goto("/schedule?term=invalid");
  await expect(
    page.getByText("Invalid Term Code; showing the latest Term."),
  ).toBeVisible();
  await expect(
    page.getByText("UST Schedule is unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Courses" }),
  ).toBeVisible();
});

test("invalid Class Numbers do not hide valid planner Classes or expose broken calendar actions", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&class=1001&class=9999&view=cart");

  await expect(
    page.getByText("Class Number 9999 could not be found"),
  ).toBeVisible();
  await expect(page.getByText("1 selected", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Shopping Cart" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download calendar" }),
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: "Calendar feed" })).toHaveCount(
    0,
  );

  await page.getByRole("link", { name: "Remove invalid Classes" }).click();
  await expect(page).not.toHaveURL(/class=9999/);
  await expect(page).toHaveURL(/class=1001/);
  await expect(
    page.getByRole("button", { name: "Download calendar" }),
  ).toBeVisible();
});

test("Schedule shows card skeletons until browser data arrives", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/schedule-courses.parquet", async (route) => {
    await waiting;
    await route.continue();
  });
  await page.goto("/schedule?term=2510");
  const loading = page.getByRole("status", { name: "Loading Schedule" });
  await expect(loading).toBeVisible();
  await expect(loading.locator('[aria-hidden="true"]')).toHaveCount(3);
  await page.screenshot({ path: ".preview/schedule-skeleton-test.png" });
  release();
  await expect(loading).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "COMP 2000 Classes" }),
  ).toBeVisible();
});

test("a selected Class without meetings renders instead of crashing cell merging", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/schedule?term=2510&class=2002&view=cart");
  await expect(
    page.getByRole("button", { name: "Remove MATH 1000 T1 (2002)" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page
      .getByRole("region", { name: "MATH 1000 Classes" })
      .getByRole("cell", { name: "TBA", exact: true }),
  ).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("section selection preserves the cards and focus without a page request", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&q=COMP");
  const section = page.getByRole("button", { name: "Add COMP 2000 L1 (1001)" });
  await expect(section).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/schedule")
      requests.push(request.url());
  });
  await page.evaluate(() => {
    const card = document.querySelector('[aria-label="COMP 2000 Classes"]');
    Object.assign(window, { selectionCard: card });
  });
  await section.click();
  const selected = page.getByRole("button", {
    name: "Remove COMP 2000 L1 (1001)",
  });
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(selected).toBeFocused();
  await expect(page).toHaveURL(/class=1001/);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { selectionCard: Element }).selectionCard ===
        document.querySelector('[aria-label="COMP 2000 Classes"]'),
    ),
  ).toBe(true);
  expect(requests).toEqual([]);
  await page.goBack();
  await expect(section).toHaveAttribute("aria-pressed", "false");
  await page.goForward();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
});

test("cart keeps sibling sections outside search and tabs support arrow keys", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&q=no-match&class=2001&view=cart");
  const sibling = page.getByRole("button", { name: "Add MATH 1000 T1 (2002)" });
  await expect(sibling).toBeVisible();
  await sibling.click();
  await expect(
    page.getByText("MATH 1000 T1 added to shopping cart."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove MATH 1000 T1 (2002)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 selected", { exact: true })).toHaveCount(0);
  await expect(page.locator("summary")).toHaveCount(0);
  const cart = page.getByRole("tab", { name: "Shopping Cart" });
  await cart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "All", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).not.toHaveURL(/view=cart/);
});

test("Schedule accepts compact course codes and term picker filters", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&q=COMP2000&class=1001");
  await expect(
    page.getByRole("heading", { name: "COMP 2000", exact: true }),
  ).toBeVisible();
  const term = page.getByRole("combobox", { name: "Term", exact: true });
  await term.fill("Winter");
  await expect(page.getByText("No Terms found.")).toBeVisible();
  await term.fill("Fall");
  await expect(page.getByRole("option", { name: /Fall/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/class=1001/);
});

test("mobile picker stays within viewport and subscription dialog is usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedule?term=2510&class=1001");
  const term = page.getByRole("combobox", { name: "Term", exact: true });
  await term.fill("x".repeat(100));
  await expect(page.getByText("No Terms found.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Subscribe to calendar", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Calendar URL", { exact: true })).toHaveValue(
    /api\/calendar\?term=2510&class=1001$/,
  );
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(15);
  expect(bounds?.width).toBeLessThanOrEqual(360);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Subscribe to calendar", exact: true }),
  ).toBeFocused();
});

for (const width of [320, 390, 640, 768, 1024, 1440]) {
  test(`open term options fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/schedule?term=2510");
    await page
      .getByRole("button", { name: "Show options", exact: true })
      .click();
    const option = page.getByRole("option", {
      name: "2025-26 Fall",
      exact: true,
    });
    await expect(option).toBeVisible();
    expect((await option.boundingBox())?.height).toBeLessThan(40);
    const popup = await page
      .locator('[data-slot="combobox-content"]')
      .boundingBox();
    expect(popup?.x).toBeGreaterThanOrEqual(0);
    expect((popup?.x ?? 0) + (popup?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("combobox", { name: "Term", exact: true }),
    ).toBeFocused();
  });
}

test("failed download leaves toolbar stable and clears on selection change", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedule?term=2510&class=2002&view=cart");
  const term = page.getByRole("combobox", { name: "Term", exact: true });
  await expect(term).toBeVisible();
  const before = await term.boundingBox();
  await page
    .getByRole("button", { name: "Download calendar", exact: true })
    .click();
  const error = page.getByText(
    "Selected Classes have no dated meetings to export.",
  );
  await expect(error).toBeVisible();
  expect(await term.boundingBox()).toEqual(before);
  await page
    .getByRole("button", { name: "Remove MATH 1000 T1 (2002)", exact: true })
    .click();
  await expect(error).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download calendar", exact: true }),
  ).toBeDisabled();
});

test("subscription checks availability, retries, and handles clipboard denial", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route("**/api/calendar?**", async (route) => {
    await waiting;
    if (fail)
      await route.fulfill({
        status: 503,
        body: "Calendar temporarily unavailable.",
      });
    else await route.continue();
  });
  await page.goto("/schedule?term=2510&class=1001");
  await page
    .getByRole("button", { name: "Subscribe to calendar", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Checking calendar…")).toBeVisible();
  await expect(dialog.getByLabel("Calendar URL", { exact: true })).toHaveCount(
    0,
  );
  release?.();
  await expect(
    dialog.getByText("Calendar temporarily unavailable."),
  ).toBeVisible();
  fail = false;
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    dialog.getByLabel("Calendar URL", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("denied");
      },
    });
  });
  await dialog
    .getByRole("button", { name: "Copy calendar URL", exact: true })
    .click();
  await expect(
    dialog.getByText("Select and copy the calendar URL above."),
  ).toBeVisible();
});

test("TBA-only subscriptions explain the problem instead of offering a broken URL", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&class=2002");
  await page
    .getByRole("button", { name: "Subscribe to calendar", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Selected Classes have no dated meetings to export."),
  ).toBeVisible();
  await expect(page.getByLabel("Calendar URL", { exact: true })).toHaveCount(0);
});

test("Back restores the latest Term when the URL omits term", async ({
  page,
}) => {
  await page.goto("/schedule");
  const term = page.getByRole("combobox", { name: "Term", exact: true });
  await expect(term).toHaveValue("2025-26 Fall");
  await page.getByRole("button", { name: "Show options", exact: true }).click();
  await page
    .getByRole("option", { name: "2024-25 Spring", exact: true })
    .click();
  await expect(term).toHaveValue("2024-25 Spring");
  await expect(
    page.getByRole("status", { name: "Loading Schedule" }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(term).toHaveValue("2025-26 Fall");
  await expect(
    page.getByRole("heading", { name: "COMP 2000", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(term).toHaveValue("2024-25 Spring");
});

test("correcting invalid view and class URLs clears notices without querying", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&view=bogus&class=bad");
  await expect(
    page.getByText("Unknown Schedule view; showing Browse."),
  ).toBeVisible();
  await expect(
    page.getByText('Ignored invalid Class Number "bad".'),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Shopping Cart", exact: true }).click();
  await expect(page).toHaveURL(/view=cart/);
  await expect(
    page.getByText("Unknown Schedule view; showing Browse."),
  ).toHaveCount(0);
  await expect(
    page.getByText('Ignored invalid Class Number "bad".'),
  ).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByText("Unknown Schedule view; showing Browse."),
  ).toBeVisible();
});
