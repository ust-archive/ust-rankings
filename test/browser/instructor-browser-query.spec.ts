import { expect, test } from "@playwright/test";

const dataOrigin = "http://127.0.0.1:17832";
const alphaUuid = "00000000-0000-4000-8000-000000000001";

test("Instructor Rankings use the pinned worker and lazy Instructor artifacts", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(dataOrigin)) requests.push(request.url());
  });
  await page.goto(
    "/rankings/instructors?term=2510&preset=grade&activity=all&q=Bulk",
  );
  const links = page
    .getByRole("list", { name: "Instructor rankings" })
    .getByRole("link");
  await expect(links).toHaveCount(100);
  await expect(links.first()).toContainText("Bulk Instructor 001");
  const names = new Set(
    requests.map((url) => new URL(url).pathname.split("/").at(-1)),
  );
  expect(names).toContain("instructor-ratings.parquet");
  expect(names).toContain("instructors.parquet");
  expect(names).toContain("relation.parquet");
  expect(names).not.toContain("course-ratings.parquet");
  expect([...names].some((name) => name?.startsWith("schedule-"))).toBe(false);
});

test("Instructor details retain identity history, corrections, relations, and zero-sample Rank", async ({
  page,
}) => {
  await page.goto(`/instructors/${alphaUuid}?term=2510`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Alpha Instructor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Identity History" }),
  ).toBeVisible();
  await expect(page.getByText("Split scope needs resolution")).toBeVisible();
  await expect(page.getByText("Calibration applied")).toBeVisible();
  await expect(
    page.getByText(/Pinned Instructor identity family:/),
  ).toBeAttached();
  await page.getByRole("heading", { name: "Rankings" }).click();
  await expect(
    page.getByRole("row", { name: /Instructor SFQ 1\.00/ }),
  ).toBeVisible();

  await page.goto(
    "/rankings/instructors?term=2510&activity=all&q=Prior%20Instructor",
  );
  const prior = page
    .getByRole("list", { name: "Instructor rankings" })
    .getByRole("link");
  await expect(prior).toHaveCount(1);
  await expect(prior).toContainText("Prior Instructor");
  await expect(prior).toContainText("#");

  await page.goto(
    "/rankings/instructors?term=2510&activity=all&q=Former%20Teacher",
  );
  const merged = page
    .getByRole("list", { name: "Instructor rankings" })
    .getByRole("link");
  await expect(merged).toHaveCount(1);
  await expect(merged).toContainText("Alpha Instructor");

  await page.goto("/rankings/instructors?term=2510&q=Alpha%20Instructor");
  await expect(
    page.getByRole("list", { name: "Instructor rankings" }).getByRole("link"),
  ).toHaveCount(2);
});

test("unknown Instructor Terms fall back consistently", async ({ page }) => {
  await page.goto(`/instructors/${alphaUuid}?term=9999`);
  await expect(
    page.getByText(
      "The requested Term has no ranking evidence. Showing the latest available Term instead.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rankings" })).toBeVisible();
  await expect(page.getByText("Learning-focused")).toBeVisible();
});

test("Instructor navigation retains the current page until a cold query resolves", async ({
  page,
}) => {
  await page.route(`${dataOrigin}/latest.json`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.goto("/rankings/courses?term=2510");
  const courseList = page.getByRole("list", { name: "Course rankings" });
  await expect(courseList).toBeVisible();
  void page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Instructors" })
    .click();
  await expect(page).toHaveURL(/\/rankings\/courses/);
  await expect(courseList).toBeVisible();
  await expect(page).toHaveURL(/\/rankings\/instructors/, { timeout: 30_000 });
  await expect(
    page.getByRole("list", { name: "Instructor rankings" }),
  ).toBeVisible();
});

test("Instructor query failure preserves static identity and Community", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route(`${dataOrigin}/latest.json`, (route) => route.abort());
  await page.goto(`/instructors/${alphaUuid}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Alpha Instructor" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Signals" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Reviews" })).toBeVisible();
  await expect(page.getByText("Rankings are unavailable.")).toBeVisible();
  expect(
    requests.some((url) =>
      /\/api\/(rankings|public-query)|\/rankings\/refresh/.test(url),
    ),
  ).toBe(false);
});
