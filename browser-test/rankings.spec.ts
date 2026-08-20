import { expect, test } from "@playwright/test";

test("Instructor Rankings retain hierarchy, URL state, and keyboard navigation to Details", async ({
  page,
}) => {
  await page.goto("/rankings/instructors");
  await expect(
    page.getByRole("heading", { name: "UST Rankings" }),
  ).toBeVisible();
  await expect(page.getByText("Instructor Rankings")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search Instructors" });
  await expect(search).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Term" })).toBeVisible();
  await expect(page.getByText("Settings...")).toBeVisible();

  const result = page.locator('a[href^="/instructors/"]').first();
  await expect(result).toBeVisible();
  await result.focus();
  await expect(result).toBeFocused();
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

  await page.getByText("Settings...").click();
  await page.getByLabel("Ranking Preset").selectOption("grade");
  await page
    .getByRole("button", { name: "Apply ranking configuration" })
    .click();
  await expect(page).toHaveURL(/preset=grade/);
  await expect(page.getByText("Grade-focused preset")).toBeVisible();
  await expect(page).toHaveURL(/q=a/);
});

test("Course Rankings preserve the restored hierarchy at 390px without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings/courses");
  await expect(
    page.getByRole("heading", { name: "UST Rankings" }),
  ).toBeVisible();
  await expect(page.getByText("Course Rankings")).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search Courses" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Term" })).toBeVisible();
  await expect(page.getByText("Settings...")).toBeVisible();

  const result = page.locator('a[href^="/courses/"]').first();
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("href", /^\/courses\/[^/]+\/[^/?]+$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await result.click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/[^/?]+$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
