import { expect, type Page, test } from "@playwright/test";

async function expectAccessibleGradeContrast(page: Page) {
  const ratios = await page.locator("[data-grade]").evaluateAll((elements) =>
    elements.map((element) => {
      const channels = getComputedStyle(element)
        .backgroundColor.match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (!channels) return 0;
      const luminance = channels
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
        );
      return 1.05 / (luminance + 0.05);
    }),
  );
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
}

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
  await expect(page.getByText("Score Formula…")).toBeVisible();
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

  await page.getByText("Score Formula…").click();
  await page.getByLabel("Ranking Preset").selectOption("grade");
  await page.getByRole("button", { name: "Apply Ranking Settings" }).click();
  await expect(page).toHaveURL(/preset=grade/);
  await expect(page.getByLabel("Ranking Preset")).toHaveValue("grade");
  await expect(page).toHaveURL(/q=a/);

  await page.getByText("Score Formula…").click();
  await page.getByLabel("Ranking Preset").selectOption("custom");
  await page.getByLabel("Activity").selectOption("all");
  await page.getByLabel("Taught Course Prefix").fill("COMP");
  await page.getByLabel("Course Code").fill("COMP 1000");
  await page.getByLabel("Content", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply Ranking Settings" }).click();
  await expect(page).toHaveURL(/preset=custom/);
  const settingsUrl = new URL(page.url());
  expect(settingsUrl.searchParams.get("q")).toBe("a");
  expect(settingsUrl.searchParams.get("preset")).toBe("custom");
  expect(settingsUrl.searchParams.get("weight_content")).toBe("2");
  expect(settingsUrl.searchParams.get("activity")).toBe("all");
  expect(settingsUrl.searchParams.get("prefix")).toBe("COMP");
  expect(settingsUrl.searchParams.get("course")).toBe("COMP 1000");

  await page.goto("/rankings/instructors");
  const selectedTerm = await page
    .getByLabel("Term", { exact: true })
    .inputValue();
  await page.getByRole("link", { name: "Next 100 Results" }).click();
  const nextPageUrl = new URL(page.url());
  expect(nextPageUrl.searchParams.get("term")).toBe(selectedTerm);
  expect(nextPageUrl.searchParams.get("cursor")).toBeTruthy();
  await expect(
    page.locator('ol[aria-label="Instructor rankings"] > li > a').first(),
  ).toContainText("#101");

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
  await expect(page.getByText("Filter…")).toBeVisible();
  await expect(page.getByText("Score Formula…")).toBeVisible();
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
  await page.getByText("Filter…").click();
  await page.getByLabel("Activity").selectOption("all");
  await page.getByLabel("Course Prefix").fill("CENG");
  await page.getByLabel("Arts", { exact: true }).check();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Apply Filters" }).click();
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
  await expect(page.getByText("Filter…")).toBeVisible();
  await expect(page.locator('a[href^="/courses/"]').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);
});
