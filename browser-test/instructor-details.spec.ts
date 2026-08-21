import { expect, test } from "@playwright/test";

test("Instructor ranking links open the approved detail hierarchy", async ({
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
  const rankings = page.getByRole("heading", { name: "Rankings" });
  const community = page.getByRole("heading", { name: "Community" });
  const courses = page.getByRole("heading", { name: "Courses" });
  const classes = page.getByRole("heading", { name: "Classes" });
  await expect(rankings).toBeVisible();
  await expect(community).toBeVisible();
  await expect(courses).toBeVisible();
  await expect(classes).toBeVisible();

  const [rankingsBox, communityBox, coursesBox] = await Promise.all([
    rankings.boundingBox(),
    community.boundingBox(),
    courses.boundingBox(),
  ]);
  expect(rankingsBox?.y).toBeLessThan(communityBox?.y ?? 0);
  expect(rankingsBox?.x).toBeLessThan(coursesBox?.x ?? 0);
  await expect(page.locator('a[href^="/schedule?"]')).toHaveCount(0);
});

test("mobile Instructor detail orders Rankings, Community, Courses, then Classes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings/instructors");
  await page.locator('a[href^="/instructors/"]').first().click();

  const rankings = page.getByRole("heading", { name: "Rankings" });
  const community = page.getByRole("heading", { name: "Community" });
  const courses = page.getByRole("heading", { name: "Courses" });
  const classes = page.getByRole("heading", { name: "Classes" });
  const [rankingsBox, communityBox, coursesBox, classesBox] = await Promise.all(
    [
      rankings.boundingBox(),
      community.boundingBox(),
      courses.boundingBox(),
      classes.boundingBox(),
    ],
  );
  expect(rankingsBox?.y).toBeLessThan(communityBox?.y ?? 0);
  expect(communityBox?.y).toBeLessThan(coursesBox?.y ?? 0);
  expect(coursesBox?.y).toBeLessThan(classesBox?.y ?? 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
