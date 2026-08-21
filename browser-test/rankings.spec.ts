import { expect, type Page, test } from "@playwright/test";

async function expectWhiteGradeLabels(page: Page) {
  const styles = await page.locator("[data-grade]").evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, textShadow: style.textShadow };
    }),
  );
  expect(styles.every(({ color }) => color === "rgb(255, 255, 255)")).toBe(
    true,
  );
  expect(styles.every(({ textShadow }) => textShadow !== "none")).toBe(true);
}

test("Rankings search filters live and keeps URL state", async ({ page }) => {
  await page.route("**/rankings/instructors**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "T")
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.goto("/rankings/instructors?preset=grade");
  const search = page.getByRole("searchbox", { name: "Search Instructors" });

  await search.fill("T");
  await page.waitForTimeout(320);
  await search.fill("TSOI");

  await expect(search).toHaveValue("TSOI");
  await expect(page).toHaveURL(/q=TSOI/);
  expect(new URL(page.url()).searchParams.get("preset")).toBe("grade");
  await expect(
    page.getByRole("heading", { name: "TSOI, Yau Chat" }),
  ).toBeVisible();

  await search.clear();
  await expect(page).not.toHaveURL(/q=/);
  expect(new URL(page.url()).searchParams.get("preset")).toBe("grade");
});

test("Rankings search retains a GET fallback without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(
    "/rankings/instructors?preset=grade&activity=all&prefix=COMP&course=COMP%201000",
  );

  await page
    .getByRole("searchbox", { name: "Search Instructors" })
    .fill("No Such Person");
  await page
    .getByRole("searchbox", { name: "Search Instructors" })
    .press("Enter");

  const fallbackUrl = new URL(page.url());
  expect(fallbackUrl.searchParams.get("q")).toBe("No Such Person");
  expect(fallbackUrl.searchParams.get("preset")).toBe("grade");
  expect(fallbackUrl.searchParams.get("activity")).toBe("all");
  expect(fallbackUrl.searchParams.get("prefix")).toBe("COMP");
  expect(fallbackUrl.searchParams.get("course")).toBe("COMP 1000");
  await expect(
    page.getByRole("heading", { name: "No Rankings Found" }),
  ).toBeVisible();
  await context.close();
});

test("Rankings append the next cursor page automatically", async ({ page }) => {
  await page.goto("/rankings/instructors?preset=grade");
  const results = page.locator(
    'ol[aria-label="Instructor rankings"] > li[data-ranking-result]',
  );
  await expect(results).toHaveCount(100);
  await expect(
    page.getByRole("link", { name: "Next 100 Results" }),
  ).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  await expect(results).toHaveCount(200);
  await expect(results.first()).toContainText(/^#1\s/);
  await expect(results.nth(100)).toContainText(/^#101\s/);
  await expect(page.getByText(/200 rankings loaded/)).toBeAttached();
  await expect(page).toHaveURL(/cursor=/);
  const paginationUrl = new URL(page.url());
  expect(paginationUrl.searchParams.get("pages")).toBe("2");
  expect(paginationUrl.searchParams.get("preset")).toBe("grade");

  await page.reload();
  await expect(results.first()).toContainText(/^#1\s/);
  await expect(results.nth(100)).toContainText(/^#101\s/);

  paginationUrl.searchParams.delete("pages");
  await page.goto(paginationUrl.toString());
  await expect(results.first()).toContainText(/^#1\s/);
  await expect(results.nth(100)).toContainText(/^#101\s/);
});

test("Instructor Rankings retain hierarchy, URL state, and keyboard navigation to Details", async ({
  page,
}) => {
  await page.goto("/rankings/instructors");
  await expect(
    page.getByRole("heading", { name: "UST Rankings" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search Instructors" });
  await expect(search).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Term" })).toContainText(
    "2026-27 Fall",
  );
  await expect(
    page.getByRole("button", { name: "Ranking Settings" }),
  ).toBeVisible();
  await expect(
    page.getByText(/samples? from ust\.space/).first(),
  ).toBeVisible();
  await expectWhiteGradeLabels(page);

  const result = page.locator('a[href^="/instructors/"]').first();
  await expect(result).toBeVisible();
  for (let press = 0; press < 15; press += 1) {
    if (await result.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(result).toBeFocused();
  expect(
    await result.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).not.toBe("0px");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/instructors\/[^/]+$/);
  await expect(
    page.getByText("Instructor", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/rankings/instructors");
  await search.fill("a");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/rankings\/instructors\?.*q=a/);
  await expect(search).toHaveValue("a");
  await expect(search.locator("..")).toHaveAttribute("aria-busy", "false");

  await page.getByRole("button", { name: "Ranking Settings" }).click();
  await expect(page).toHaveURL(/settings=open/);
  await expect(
    page.getByRole("radio", { name: "Knowledge-Focus'd" }),
  ).toBeChecked();
  await expect(page.getByText("Learning-Focus'd")).toHaveCount(0);
  await page.getByRole("radio", { name: "Grading-Focus'd" }).click();
  await expect(page).toHaveURL(/preset=grade/);
  await expect(page).toHaveURL(/settings=open/);
  await expect(page).toHaveURL(/q=a/);

  await page.getByRole("radio", { name: "Custom" }).click();
  await expect(page).toHaveURL(/preset=custom/);
  await page.getByRole("combobox", { name: "Instructors" }).click();
  await page.getByRole("option", { name: "All" }).click();
  await page.getByLabel("Content", { exact: true }).fill("2");
  await expect(page).toHaveURL(/weight_content=2/);
  const settingsUrl = new URL(page.url());
  expect(settingsUrl.searchParams.get("q")).toBe("a");
  expect(settingsUrl.searchParams.get("preset")).toBe("custom");
  expect(settingsUrl.searchParams.get("weight_content")).toBe("2");
  expect(settingsUrl.searchParams.get("activity")).toBe("all");
  expect(settingsUrl.searchParams.has("prefix")).toBe(false);
  expect(settingsUrl.searchParams.has("course")).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings/instructors");
  const mobileInstructorName = page
    .locator('ol[aria-label="Instructor rankings"] h2')
    .first();
  await expect(mobileInstructorName).toBeVisible();
  expect(
    await mobileInstructorName.evaluate(
      (element) => getComputedStyle(element).whiteSpace,
    ),
  ).toBe("normal");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("the footer provides a responsive Vercel-style navigation grid", async ({
  page,
}) => {
  await page.goto("/rankings/instructors");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(footer.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(footer.getByRole("heading", { name: "Project" })).toBeVisible();
  await expect(footer.getByRole("heading", { name: "Legal" })).toBeVisible();
  await expect(
    footer.getByRole("link", { name: "Instructor Rankings" }),
  ).toHaveAttribute("href", "/rankings/instructors");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("Course Rankings preserve the restored hierarchy at 390px without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings/courses");
  await expect(
    page.getByRole("heading", { name: "UST Rankings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search Courses" }),
  ).toBeVisible();
  const term = page.getByRole("combobox", { name: "Term" });
  await expect(term).toContainText("2026-27 Fall");
  await term.click();
  await page.getByRole("option", { name: "2025-26 Fall" }).click();
  await expect(page).toHaveURL(/term=2510/);
  await expect(
    page.getByRole("button", { name: "Ranking Settings" }),
  ).toBeVisible();
  await expect(page.getByText(/samples? from SFQ/).first()).toBeVisible();
  await expectWhiteGradeLabels(page);

  const result = page.locator('a[href^="/courses/"]').first();
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("href", /^\/courses\/[^/]+\/[^/?]+$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  for (let press = 0; press < 15; press += 1) {
    if (await result.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(result).toBeFocused();
  expect(
    await result.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).not.toBe("0px");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/courses\/[^/]+\/[^/?]+$/);

  await page.goto("/rankings/courses");
  await page.getByRole("button", { name: "Ranking Settings" }).click();
  await page.getByRole("combobox", { name: "Courses" }).click();
  await page.getByRole("option", { name: "All" }).click();
  await page.getByRole("combobox", { name: "Common Core Cohort" }).click();
  await page.getByRole("option", { name: "Students Admitted in 2025" }).click();
  await page.getByLabel("Arts", { exact: true }).check();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(page).toHaveURL(/commonCore=arts/);
  const filterUrl = new URL(page.url());
  expect(filterUrl.searchParams.get("activity")).toBe("all");
  expect(filterUrl.searchParams.get("commonCoreScheme")).toBe("CC25");
  expect(filterUrl.searchParams.has("prefix")).toBe(false);
  expect(filterUrl.searchParams.getAll("commonCore")).toContain("arts");
  expect(filterUrl.searchParams.get("term")).toBeTruthy();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/rankings/courses");
  await expect(
    page.getByRole("button", { name: "Ranking Settings" }),
  ).toBeVisible();
  await expect(page.locator('a[href^="/courses/"]').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);
});
