import { expect, test } from "@playwright/test";

const dataOrigin = "http://127.0.0.1:17832";

declare global {
  interface Window {
    duckdbWorkerCount: number;
  }
}

test("Course Rankings use one pinned worker generation and fetch only Course artifacts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.duckdbWorkerCount = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        window.duckdbWorkerCount += 1;
        super(url, options);
      }
    };
  });
  const dataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(dataOrigin)) dataRequests.push(request.url());
  });

  await page.goto(
    "/rankings/courses?term=2510&preset=grade&activity=all&q=Bulk",
  );
  const rankings = page.getByRole("list", { name: "Course rankings" });
  await expect(rankings.getByRole("link")).toHaveCount(100);
  await expect(rankings.getByRole("link").first()).toContainText("BULK 1000");
  await expect(rankings.getByRole("link").first()).toContainText("#4");
  await expect
    .poll(() => page.evaluate(() => window.duckdbWorkerCount))
    .toBe(1);

  const requested = new Set(
    dataRequests.map((url) => new URL(url).pathname.split("/").at(-1)),
  );
  for (const name of [
    "course-ratings.parquet",
    "courses.parquet",
    "instructors.parquet",
    "instructor-aliases.parquet",
    "instructor-identity-events.parquet",
    "instructor-split-associations.parquet",
    "relation.parquet",
  ])
    expect(requested).toContain(name);
  expect(requested).not.toContain("instructor-ratings.parquet");
  expect([...requested].some((name) => name?.startsWith("schedule-"))).toBe(
    false,
  );

  const latestRequests = () =>
    dataRequests.filter((url) => url.endsWith("/latest.json")).length;
  expect(latestRequests()).toBe(1);
  await page.route(`${dataOrigin}/latest.json`, (route) => route.abort());
  await rankings.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/courses\/BULK\/1000/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("BULK 1000");
  await expect(
    page.getByText("Pinned Course–Instructor relations:"),
  ).toContainText(/\d+/);
  expect(latestRequests()).toBe(1);
  expect(await page.evaluate(() => window.duckdbWorkerCount)).toBe(1);
});

test("Course filtering preserves population Rank and searches Instructor relations", async ({
  page,
}) => {
  await page.goto(
    "/rankings/courses?term=2510&commonCoreScheme=CC25&commonCore=arts&q=Alpha%20Instructor",
  );
  const links = page
    .getByRole("list", { name: "Course rankings" })
    .getByRole("link");
  await expect(links).toHaveCount(1);
  await expect(links.first()).toContainText("COMP 1000");
  await expect(links.first()).toContainText("#2");
});

test("Course details retain historical evidence and relation parity", async ({
  page,
}) => {
  await page.goto("/courses/comp/2000?term=2510");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(page.getByText("Loading Rankings…")).toHaveCount(0);
  await page.getByRole("heading", { name: "Rankings" }).click();
  await expect(page.getByRole("row", { name: /Content 0\.25/ })).toBeVisible();
  await expect(
    page.getByText("Pinned Course–Instructor relations: 2"),
  ).toBeAttached();
  await expect(page.getByText("2025-26 Fall").first()).toBeVisible();
  await expect(page.getByText("Rankings are unavailable.")).toHaveCount(0);
});

test("Course navigation retains the current page until a cold browser query resolves", async ({
  page,
}) => {
  await page.route(`${dataOrigin}/latest.json`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.goto("/rankings/instructors");
  const instructorList = page.getByRole("list", {
    name: "Instructor rankings",
  });
  await expect(instructorList).toBeVisible();

  const navigation = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Courses" })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Loading page" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/rankings\/instructors/);
  await expect(instructorList).toBeVisible();
  await navigation;
  await expect(page).toHaveURL(/\/rankings\/courses/);
  await expect(
    page.getByRole("list", { name: "Course rankings" }),
  ).toBeVisible();
});

test("public query failure preserves static Course identity and Community without a server fallback", async ({
  page,
}) => {
  const applicationRequests: string[] = [];
  page.on("request", (request) => applicationRequests.push(request.url()));
  await page.route(`${dataOrigin}/latest.json`, (route) => route.abort());

  await page.goto("/courses/comp/2000");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Alpha Instructor" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Rankings are unavailable.")).toBeVisible();
  expect(
    applicationRequests.some((url) =>
      /\/api\/(rankings|public-query)|\/rankings\/refresh/.test(url),
    ),
  ).toBe(false);
});
