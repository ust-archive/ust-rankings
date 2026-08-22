import { expect, test } from "@playwright/test";

test("Review Order persists in the URL and works on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/courses/comp/2000");

  const order = page.getByRole("combobox", { name: "Order" });
  await expect(order).toHaveValue("top");
  await order.selectOption("popular");
  await expect(page).toHaveURL(/order=popular/);
  await page.reload();
  await expect(order).toHaveValue("popular");

  await order.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page).toHaveURL(/order=recent/);
  await expect(order).toHaveValue("recent");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  for (const query of ["order=unknown", "order=popular&order=recent"]) {
    await page.goto(`/courses/comp/2000?${query}`);
    await expect(order).toHaveValue("top");
  }
});
