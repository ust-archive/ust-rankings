import { expect, test } from "@playwright/test";

test("Instructor ranking links open the evidence-first detail hierarchy", async ({
  page,
}) => {
  await page.goto("/rankings/instructors");
  const instructorLink = page.locator('a[href^="/instructors/"]').first();
  await expect(instructorLink).toBeVisible();
  await instructorLink.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByText("Instructor", { exact: true }).first(),
  ).toBeVisible();
  const evidence = page.getByRole("heading", {
    name: "Ranking evidence and trends",
  });
  const reviews = page.getByRole("heading", { name: "Community Reviews" });
  const actions = page.getByRole("heading", { name: "Instructor actions" });
  const associations = page.getByRole("heading", {
    name: "Associated Courses and Classes",
  });
  await expect(evidence).toBeVisible();
  await expect(reviews).toBeVisible();
  await expect(actions).toBeVisible();
  await expect(associations).toBeVisible();
  if (process.env.CONTRIBUTIONS_POSTGRES_URL) {
    await expect(page.getByText("Community pulse")).toBeVisible();
    await expect(page.getByText("Separate from ranking scores")).toBeVisible();
    await expect(page.getByText("Sign in to respond")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Thumbs up · 0" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: "Love · 0" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("body")).not.toContainText("participant list");
  }

  const [evidenceBox, reviewsBox, actionsBox] = await Promise.all([
    evidence.boundingBox(),
    reviews.boundingBox(),
    actions.boundingBox(),
  ]);
  expect(evidenceBox?.y).toBeLessThan(reviewsBox?.y ?? 0);
  expect(evidenceBox?.x).toBeLessThan(actionsBox?.x ?? 0);
});

test("mobile Instructor detail puts actions, evidence, Reviews, then associations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings/instructors");
  await page.locator('a[href^="/instructors/"]').first().click();

  const actions = page.getByRole("heading", { name: "Instructor actions" });
  const evidence = page.getByRole("heading", {
    name: "Ranking evidence and trends",
  });
  const reviews = page.getByRole("heading", { name: "Community Reviews" });
  const associations = page.getByRole("heading", {
    name: "Associated Courses and Classes",
  });
  const [actionsBox, evidenceBox, reviewsBox, associationsBox] =
    await Promise.all([
      actions.boundingBox(),
      evidence.boundingBox(),
      reviews.boundingBox(),
      associations.boundingBox(),
    ]);
  expect(actionsBox?.y).toBeLessThan(evidenceBox?.y ?? 0);
  expect(evidenceBox?.y).toBeLessThan(reviewsBox?.y ?? 0);
  expect(reviewsBox?.y).toBeLessThan(associationsBox?.y ?? 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
