import { expect, type Page, test } from "@playwright/test";

async function expectAccessibleGradeContrast(page: Page) {
  const ratios = await page.locator("[data-grade]").evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      const colors = [style.backgroundColor, style.color].map((value) =>
        value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number),
      );
      const [background, foreground] = colors;
      if (!background || !foreground) return 0;
      const luminance = [background, foreground].map((channels) =>
        channels
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4,
          )
          .reduce(
            (sum, channel, index) =>
              sum + channel * [0.2126, 0.7152, 0.0722][index],
            0,
          ),
      );
      return (Math.max(...luminance) + 0.05) / (Math.min(...luminance) + 0.05);
    }),
  );
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
}

test("Rankings search filters live and keeps URL state", async ({ page }) => {
  await page.goto("/rankings/instructors");
  const search = page.getByRole("searchbox", { name: "Search Instructors" });

  await search.fill("TSOI");

  await expect(page).toHaveURL(/q=TSOI/);
  await expect(
    page.getByRole("heading", { name: "TSOI, Yau Chat" }),
  ).toBeVisible();
});

test("Rankings append the next cursor page automatically", async ({ page }) => {
  await page.goto("/rankings/instructors");
  const results = page.locator('ol[aria-label="Instructor rankings"] > li');
  await expect(results).toHaveCount(100);
  await expect(
    page.getByRole("link", { name: "Next 100 Results" }),
  ).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  await expect(results).toHaveCount(200);
  await expect(results.first()).toContainText("#1");
  await expect(results.nth(100)).toContainText("#101");
  await expect(page).toHaveURL(/cursor=/);
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
  await expect(page.getByRole("combobox", { name: "Term" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ranking Settings" }),
  ).toBeVisible();
  await expect(
    page.getByText(/samples? from ust\.space/).first(),
  ).toBeVisible();
  await expectAccessibleGradeContrast(page);

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

  await page.getByRole("button", { name: "Ranking Settings" }).click();
  await expect(page).toHaveURL(/settings=open/);
  await page.getByRole("radio", { name: "Grading-Focus'd" }).click();
  await page.getByRole("button", { name: "Apply Settings" }).click();
  await expect(page).toHaveURL(/preset=grade/);
  await expect(page).not.toHaveURL(/settings=open/);
  await expect(page).toHaveURL(/q=a/);

  await page.getByRole("button", { name: "Ranking Settings" }).click();
  await page.getByRole("radio", { name: "Custom" }).click();
  await page.getByRole("combobox", { name: "Activity" }).click();
  await page
    .getByRole("option", { name: "Include historical or inactive" })
    .click();
  await page.getByLabel("Taught Course Prefix").fill("COMP");
  await page.getByLabel("Course Code").fill("COMP 1000");
  await page.getByLabel("Content", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply Settings" }).click();
  await expect(page).toHaveURL(/preset=custom/);
  const settingsUrl = new URL(page.url());
  expect(settingsUrl.searchParams.get("q")).toBe("a");
  expect(settingsUrl.searchParams.get("preset")).toBe("custom");
  expect(settingsUrl.searchParams.get("weight_content")).toBe("2");
  expect(settingsUrl.searchParams.get("activity")).toBe("all");
  expect(settingsUrl.searchParams.get("prefix")).toBe("COMP");
  expect(settingsUrl.searchParams.get("course")).toBe("COMP 1000");

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
  await expect(page.getByRole("combobox", { name: "Term" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ranking Settings" }),
  ).toBeVisible();
  await expect(page.getByText(/samples? from SFQ/).first()).toBeVisible();
  await expectAccessibleGradeContrast(page);

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
  await page.getByRole("combobox", { name: "Activity" }).click();
  await page
    .getByRole("option", { name: "Include historical or inactive" })
    .click();
  await page.getByLabel("Course Prefix").fill("CENG");
  await page.getByLabel("Arts", { exact: true }).check();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Apply Settings" }).click();
  await expect(page).toHaveURL(/commonCore=arts/);
  const filterUrl = new URL(page.url());
  expect(filterUrl.searchParams.get("activity")).toBe("all");
  expect(filterUrl.searchParams.get("prefix")).toBe("CENG");
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
