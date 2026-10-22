import { expect, test } from "@playwright/test";

test("Tools opens Distribution Fitting and updates standing as values change", async ({
  page,
}) => {
  await page.goto("/rankings/instructors");
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Tools", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tools$/);
  const heading = page.getByRole("heading", { name: "UST Tools", level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS("background-image", /linear-gradient/);
  const tools = page.getByRole("region", { name: "Tools", exact: true });
  await expect(tools.getByRole("heading", { level: 2 })).toHaveCount(1);
  await expect(
    tools.getByRole("heading", { name: "Distribution Fitting", exact: true }),
  ).toBeVisible();

  const open = tools.getByRole("button", { name: "Open Tool" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Distribution Fitting" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(
    dialog.getByRole("button", { name: /Fit Distribution/i }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Try an Example" }).click();
  for (const [name, value] of [
    [/^Low$/, "0"],
    [/^High$/, "100"],
    [/^Lower Quartile \(LQ\)/, "40"],
    [/^Upper Quartile \(UQ\)/, "70"],
    [/^Median/, "55"],
    [/^Mean/, "54"],
    [/^Your Score$/, "75"],
  ] as const) {
    await expect(dialog.getByRole("spinbutton", { name })).toHaveValue(value);
  }
  await expect(
    dialog.getByRole("spinbutton", { name: /^Standard Deviation/ }),
  ).toHaveValue("");
  const result = dialog.getByRole("region", { name: "Distribution Result" });
  await expect(result).toContainText(/Top \d+\.\d+%/);
  await expect(result).toContainText("Above approximately");
  const curve = result.getByRole("img", {
    name: /Estimated Grade Distribution/i,
  });
  await expect(curve).toBeVisible();
  await expect(curve).toHaveAccessibleName(/Your score is 75/i);
  await expect(dialog).not.toContainText(
    /Relative Frequency|Summary statistics cannot reveal|Calculations stay in your browser|same score scale/i,
  );

  for (const [name, value] of [
    [/^Lower Quartile \(LQ\)/, "25"],
    [/^Upper Quartile \(UQ\)/, "75"],
    [/^Median/, "50"],
    [/^Mean/, "50"],
    [/^Your Score$/, "80"],
  ] as const) {
    await dialog.getByRole("spinbutton", { name }).fill(value);
  }
  await expect(result).toContainText("Top 20.0%");
  await expect(
    dialog.getByRole("spinbutton", { name: "Your Score", exact: true }),
  ).toBeFocused();

  await dialog
    .getByRole("spinbutton", { name: /^Lower Quartile \(LQ\)/ })
    .fill("90");
  await expect(result).not.toContainText("Estimated Standing");
  await expect(curve).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toContainText(
    /low ≤ lower quartile ≤ median ≤ upper quartile ≤ high/i,
  );
  await expect(
    dialog.getByRole("spinbutton", { name: /^Lower Quartile \(LQ\)/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page).toHaveURL(/\/tools$/);
});

test("Distribution Fitting accepts mean and deviation without quartiles", async ({
  page,
}) => {
  await page.goto("/tools");
  await page.getByRole("button", { name: "Open Tool" }).click();
  const dialog = page.getByRole("dialog", { name: "Distribution Fitting" });
  for (const [name, value] of [
    [/^Low$/, "0"],
    [/^High$/, "100"],
    [/^Mean/, "50"],
    [/^Standard Deviation/, "20"],
    [/^Your Score$/, "75"],
  ] as const) {
    await dialog.getByRole("spinbutton", { name }).fill(value);
  }
  for (const name of [/^Lower Quartile/, /^Median/, /^Upper Quartile/]) {
    await expect(dialog.getByRole("spinbutton", { name })).toHaveValue("");
  }
  const result = dialog.getByRole("region", { name: "Distribution Result" });
  await expect(result).toContainText(/Top \d+\.\d+%/);
  await expect(
    result.getByRole("img", { name: /Estimated Grade Distribution/i }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("spinbutton", { name: "Your Score", exact: true }),
  ).toBeFocused();
});

test("Tools is keyboard accessible at 390px without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings/instructors");
  const toolsLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Tools", exact: true });
  await expect(toolsLink).toBeVisible();
  await toolsLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  const open = page.getByRole("button", { name: "Open Tool" });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Distribution Fitting" });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
});
