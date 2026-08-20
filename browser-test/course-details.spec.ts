import { expect, test } from "@playwright/test";

test("Schedule cross-links reach validated Offering and Class details with keyboard access", async ({
  page,
}) => {
  await page.goto("/schedule");
  const offeringLink = page.locator('h3 a[href^="/courses/"]').first();
  await expect(offeringLink).toBeVisible();
  await offeringLink.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByText("Course Offering", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ranking evidence and trends" }),
  ).toBeVisible();
  const reviewsHeading = page.getByRole("heading", {
    name: "Community Reviews",
  });
  await expect(reviewsHeading).toBeVisible();
  const [desktopEvidence, desktopReviews, desktopActions] = await Promise.all([
    page
      .getByRole("heading", { name: "Ranking evidence and trends" })
      .boundingBox(),
    reviewsHeading.boundingBox(),
    page
      .getByRole("heading", { name: "Course Offering actions" })
      .boundingBox(),
  ]);
  expect(desktopEvidence?.y).toBeLessThan(desktopReviews?.y ?? 0);
  expect(desktopEvidence?.x).toBeLessThan(desktopActions?.x ?? 0);

  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    primary.getByRole("link", { name: "Instructors" }),
  ).toBeVisible();
  await expect(primary.getByRole("link", { name: "Courses" })).toBeVisible();
  await expect(primary.getByRole("link", { name: "Schedule" })).toBeVisible();
  const footer = page.getByRole("navigation", { name: "Footer navigation" });
  await expect(footer.getByRole("link", { name: /Privacy/ })).toHaveAttribute(
    "href",
    "/privacy",
  );
  await expect(footer.getByRole("link", { name: "FAQ" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Contact" })).toBeVisible();

  await page.goBack();
  const classLink = page
    .locator('th[scope="row"] a[href^="/courses/"]')
    .first();
  await classLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Class", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Class Number \d+/)).toBeVisible();
  await expect(page.getByText(/not a signal target/)).toBeVisible();

  await page.getByRole("link", { name: "Open in Schedule" }).click();
  await expect(page).toHaveURL(/\/schedule\?term=\d{4}&class=\d+&view=cart$/);
  await expect(
    page.getByText("1 selected Class", { exact: true }),
  ).toBeVisible();
});

test("Course Review composer is keyboard-accessible and explains attribution and licensing", async ({
  page,
}) => {
  await page.goto("/schedule");
  const offeringPath = await page
    .locator('h3 a[href^="/courses/"]')
    .first()
    .getAttribute("href");
  const coursePath = offeringPath?.split("/").slice(0, 4).join("/");
  expect(coursePath).toBeTruthy();
  await page.goto(coursePath as string);
  const open = page.getByRole("button", { name: "Write a Review" });
  await open.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Write your Review" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Include Course Basis")).toBeFocused();
  await expect(dialog).toContainText("Identity hidden");
  await expect(dialog).toContainText("not anonymous to UST Rankings");
  await expect(dialog).toContainText("authorized operator can link");
  await expect(dialog).toContainText("CC BY 4.0");
  await expect(dialog).toContainText("non-exclusive site license");
  await expect(
    dialog.getByRole("button", { name: "Publish Revision" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /vote|reaction/i }),
  ).toHaveCount(0);

  const markdown = dialog.getByLabel("Review · Markdown");
  await markdown.fill(
    "My **entered Review** <script>alert('xss')</script> ![remote](https://evil.example/pixel.png)",
  );
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(
    dialog.getByText("entered Review", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("script")).toHaveCount(0);
  await expect(dialog.locator("img")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Write" }).click();
  const instructorBasis = dialog.getByLabel("Include Instructor Basis");
  if (await instructorBasis.isEnabled()) {
    await instructorBasis.check();
    await expect(dialog.getByLabel("Term")).toBeEnabled();
    await dialog.getByLabel("Include Course Basis").uncheck();
    await expect(dialog.getByLabel("Section")).toBeDisabled();
    await expect(markdown).toHaveValue(/My \*\*entered Review\*\*/);
  }

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("public Course signals expose accessible aggregates without exposing participants", async ({
  page,
}) => {
  test.skip(
    !process.env.CONTRIBUTIONS_POSTGRES_URL,
    "requires disposable contribution PostgreSQL",
  );
  await page.goto("/schedule");
  const offeringPath = await page
    .locator('h3 a[href^="/courses/"]')
    .first()
    .getAttribute("href");
  const coursePath = offeringPath?.split("/").slice(0, 4).join("/");
  await page.goto(coursePath as string);

  await expect(page.getByText("Community pulse")).toBeVisible();
  await expect(page.getByText("Separate from ranking scores")).toBeVisible();
  await expect(page.getByText("Sign in to respond")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Thumbs up · 0" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Love · 0" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("body")).not.toContainText("participant list");
});

test("mobile Course detail puts actions before evidence and Reviews", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedule");
  await page.locator('h3 a[href^="/courses/"]').first().click();

  const action = page.getByRole("heading", { name: "Course Offering actions" });
  const evidence = page.getByRole("heading", {
    name: "Ranking evidence and trends",
  });
  const reviews = page.getByRole("heading", { name: "Community Reviews" });
  await expect(action).toBeVisible();
  await expect(evidence).toBeVisible();
  await expect(reviews).toBeVisible();

  const [actionBox, evidenceBox, reviewsBox] = await Promise.all([
    action.boundingBox(),
    evidence.boundingBox(),
    reviews.boundingBox(),
  ]);
  expect(actionBox?.y).toBeLessThan(evidenceBox?.y ?? 0);
  expect(evidenceBox?.y).toBeLessThan(reviewsBox?.y ?? 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
