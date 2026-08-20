import { expect, test } from "@playwright/test";

const term = "2510";

function scheduleUrl(classNumbers: number[], view = "cart", search?: string) {
  const parameters = new URLSearchParams({ term });
  if (search) parameters.set("q", search);
  for (const classNumber of classNumbers)
    parameters.append("class", String(classNumber));
  parameters.set("view", view);
  return `/schedule?${parameters}`;
}

test("signed-out planner state is canonical, reloadable, shareable, and uses history", async ({
  page,
}) => {
  await page.goto("/schedule");
  await expect(
    page.getByRole("heading", { name: "UST Schedule" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/schedule\?term=\d{4}&view=browse$/);

  const add = page
    .getByRole("link", { name: /Add Class \d+ to planner cart/ })
    .first();
  const label = await add.getAttribute("aria-label");
  const classNumber = label?.match(/\d+/)?.[0];
  expect(classNumber).toBeTruthy();

  await add.click();
  await expect(page).toHaveURL(
    new RegExp(`class=${classNumber}.*view=browse$`),
  );
  await expect(
    page.getByText("1 selected Class", { exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/class=/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`class=${classNumber}`));
  await page.reload();
  await expect(
    page.getByText("1 selected Class", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Planner cart", exact: true }).click();
  await expect(page).toHaveURL(/view=cart$/);
  await expect(
    page.getByRole("heading", { name: /planner cart/ }),
  ).toBeVisible();

  await page.getByRole("searchbox", { name: "Search Schedule" }).fill("ACCT");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=ACCT.*class=.*view=cart$/);

  const termSelect = page.getByRole("combobox", { name: "Term" });
  const currentTerm = await termSelect.inputValue();
  const differentTerm = await termSelect
    .locator("option")
    .evaluateAll(
      (options, selected) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value !== selected),
      currentTerm,
    );
  if (!differentTerm) throw new Error("Fixture needs at least two Terms");
  await termSelect.selectOption(differentTerm);
  await page.getByRole("button", { name: "Change Term" }).click();
  await expect(page).not.toHaveURL(/class=/);
  await expect(page).toHaveURL(/q=ACCT.*view=cart$/);
});

test("invalid Term state cannot substitute a latest-Term Class", async ({
  page,
}) => {
  await page.goto("/schedule?term=bad&class=1001&view=cart");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Invalid Term Code; showing the latest Term.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("0 selected Classes", { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/class=1001/);

  await page.goto("/schedule?term=2510&term=2520&class=1001&view=cart");
  await expect(
    page.getByRole("alert").filter({ hasText: "Use exactly one Term Code." }),
  ).toBeVisible();
  await expect(
    page.getByText("0 selected Classes", { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/class=1001/);
});

test("noncanonical Classes normalize without history and conflicts are announced", async ({
  page,
}) => {
  await page.goto("/faq");
  await page.goto(
    "/schedule?term=2510&class=4227&class=3698&class=4227&view=cart",
  );
  await expect(page).toHaveURL(
    "/schedule?term=2510&class=3698&class=4227&view=cart",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Schedule conflict" }),
  ).toContainText("Classes 3698 and 4227 have overlapping meeting times.");
  await page.goBack();
  await expect(page).toHaveURL("/faq");
  await page.goForward();
  await expect(page).toHaveURL(
    "/schedule?term=2510&class=3698&class=4227&view=cart",
  );
  await page.reload();
  await expect(
    page.getByText("2 selected Classes", { exact: true }),
  ).toBeVisible();
});

test("SIS dialog reports invalid and over-limit imports with keyboard focus restoration", async ({
  page,
}) => {
  await page.goto(scheduleUrl([], "browse", "ACCT 3610"));
  const trigger = page.getByRole("button", { name: "Import from SIS" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  const text = page.getByLabel("SIS page text");
  await text.fill("No matching Classes");
  await expect(page.locator("#sis-import-status")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.locator("#sis-import-status")).toContainText(
    "No Class Numbers were found",
  );
  await expect(
    page.getByRole("button", { name: "Add to planner cart" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  const fullCart = Array.from({ length: 50 }, (_, index) => index + 1001);
  await page.goto(scheduleUrl(fullCart, "browse", "1051"));
  await expect(page.getByRole("status")).toContainText(
    "The planner cart is limited to 50 Classes.",
  );
  await expect(
    page.getByRole("button", {
      name: "Cannot add Class 1051; planner cart is full",
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Import from SIS" }).click();
  await page.getByLabel("SIS page text").fill("LEC (1051)");
  await expect(page.locator("#sis-import-status")).toContainText(
    "The planner cart is limited to 50 Classes.",
  );
  await expect(
    page.getByRole("button", { name: "Add to planner cart" }),
  ).toBeDisabled();
  await expect(
    page.getByText("50 selected Classes", { exact: true }),
  ).toBeVisible();
});

test("mobile planner controls and empty state remain usable without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scheduleUrl([], "cart"));
  await expect(page.getByRole("status")).toContainText(
    "No Classes are selected",
  );
  await expect(
    page.getByRole("link", { name: "Browse Classes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import from SIS" }),
  ).toBeVisible();
  const overflowingScheduleSections = await page.evaluate(() =>
    [...document.querySelectorAll("main > *")]
      .filter(
        (element) => element.getBoundingClientRect().right > window.innerWidth,
      )
      .map((element) => element.tagName),
  );
  expect(overflowingScheduleSections).toEqual([]);
});
