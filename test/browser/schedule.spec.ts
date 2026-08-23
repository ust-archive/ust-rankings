import { expect, test } from "@playwright/test";

test("Schedule planner state stays shareable and usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedule?term=2510");

  const search = page.getByRole("searchbox", { name: "Search Schedule" });
  await search.fill("COMP");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=COMP/);
  const classTable = page.getByRole("region", { name: "COMP 2000 Classes" });
  await classTable.focus();
  await expect(classTable).toBeFocused();

  await page.getByRole("link", { name: "Add" }).first().click();
  await expect(page).toHaveURL(/class=1001/);
  await expect(page).toHaveURL(/view=cart/);
  await expect(page.getByRole("link", { name: "Planner (1)" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Selected Classes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download calendar" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Import from SIS" }).click();
  const addClasses = page.getByRole("button", { name: "Add Classes" });
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
  await expect(page.getByRole("link", { name: "Planner (2)" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("invalid Class Numbers do not hide valid planner Classes or expose broken calendar actions", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&class=1001&class=9999&view=cart");

  await expect(
    page.getByText("Class Number 9999 could not be found"),
  ).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(page.getByRole("link", { name: "Planner (1)" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download calendar" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Calendar feed" })).toHaveCount(
    0,
  );

  await page.getByRole("link", { name: "Remove invalid Classes" }).click();
  await expect(page).not.toHaveURL(/class=9999/);
  await expect(page).toHaveURL(/class=1001/);
  await expect(
    page.getByRole("link", { name: "Download calendar" }),
  ).toBeVisible();
});
