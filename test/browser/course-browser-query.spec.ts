import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { browserContributionsUrl } from "../browser-contributions-fixture";

const dataOrigin = "http://127.0.0.1:17832";

declare global {
  interface Window {
    duckdbWorkerCount: number;
    publicQueryWorkerCount: number;
  }
}

test("Course Rankings use one pinned worker generation and prefetch Instructor Rankings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.duckdbWorkerCount = 0;
    window.publicQueryWorkerCount = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        window.duckdbWorkerCount += 1;
        if (options?.name === "public-course-query")
          window.publicQueryWorkerCount += 1;
        super(url, options);
      }
    };
  });
  const dataRequests: string[] = [];
  const parquetResponses: Array<{
    contentRange?: string;
    status: number;
    url: string;
  }> = [];
  page.on("request", (request) => {
    if (request.url().startsWith(dataOrigin)) dataRequests.push(request.url());
  });
  page.on("response", async (response) => {
    if (
      response.url().startsWith(dataOrigin) &&
      response.url().endsWith(".parquet") &&
      response.request().method() === "GET"
    )
      parquetResponses.push({
        contentRange: (await response.allHeaders())["content-range"],
        status: response.status(),
        url: response.url(),
      });
  });

  await page.goto(
    "/rankings/courses?term=2510&preset=grade&activity=all&q=Bulk",
  );
  const rankings = page.getByRole("list", { name: "Course rankings" });
  await expect(rankings.getByRole("link")).toHaveCount(100);
  await expect(rankings.getByRole("link").first()).toContainText("BULK 1000");
  await expect(rankings.getByRole("link").first()).toContainText("#5");
  await expect
    .poll(() => page.evaluate(() => window.duckdbWorkerCount))
    .toBe(1);
  expect(await page.evaluate(() => window.publicQueryWorkerCount)).toBe(1);

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
  expect(requested).toContain("instructor-ratings.parquet");
  expect([...requested].some((name) => name?.startsWith("schedule-"))).toBe(
    false,
  );
  expect(parquetResponses.length).toBeGreaterThan(0);
  for (const response of parquetResponses) {
    expect([200, 206]).toContain(response.status);
    if (response.status === 206)
      expect(response.contentRange).toMatch(/^bytes /);
  }
  const courseRatingsUrl = dataRequests.find((url) =>
    url.endsWith("/course-ratings.parquet"),
  );
  if (!courseRatingsUrl) throw new Error("Course ratings were not requested");
  const range = await page.request.get(courseRatingsUrl, {
    headers: { range: "bytes=0-99" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-99\//);

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
  expect(await page.evaluate(() => window.publicQueryWorkerCount)).toBe(1);
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
  await expect(links.first()).toContainText("#3");
});

test("Course search updates the Worker locally without an RSC navigation", async ({
  page,
}) => {
  await page.goto("/rankings/courses?term=2510");
  await expect(
    page.getByRole("list", { name: "Course rankings" }),
  ).toBeVisible();
  const rscRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers().rsc === "1") rscRequests.push(request.url());
  });

  await page
    .getByRole("searchbox", { name: "Search Courses" })
    .fill("COMP 1000");
  expect(new URL(page.url()).searchParams.get("q")).toBe("COMP 1000");
  const results = page
    .getByRole("list", { name: "Course rankings" })
    .getByRole("link");
  await expect(results).toHaveCount(1);
  await expect(results).toContainText("COMP 1000");
  expect(
    rscRequests.filter((url) => new URL(url).pathname === "/rankings/courses"),
  ).toEqual([]);
});

test("custom Course weights preserve server scoring", async ({ page }) => {
  await page.goto(
    "/rankings/courses?term=2510&preset=custom&weight_content=2&activity=all&q=COMP%201000",
  );
  const result = page
    .getByRole("list", { name: "Course rankings" })
    .getByRole("link");
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("COMP 1000");
  await expect(result).toContainText("100.0");
  await expect(result).toContainText("#1");
});

test("Course details retain historical evidence and relation parity", async ({
  page,
}) => {
  await page.goto("/courses/comp/2000?term=2510");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(page.getByText("Loading Rankings…")).toHaveCount(0);
  await expect(page.getByText("Catalog details unavailable")).toHaveCount(0);
  await expect(page.getByText("Term name unavailable")).toHaveCount(0);
  await expect(page.getByText("Updated Course title").first()).toBeVisible();
  await page.getByRole("heading", { name: "Rankings" }).click();
  await expect(page.getByRole("row", { name: /Content 0\.25/ })).toBeVisible();
  await expect(
    page.getByText("Pinned Course–Instructor relations: 2"),
  ).toBeAttached();
  await expect(page.getByText("2025-26 Fall").first()).toBeVisible();
  await expect(page.getByText("Rankings are unavailable.")).toHaveCount(0);
});

test("Course Rankings prefetch after Instructor Rankings become ready", async ({
  page,
}) => {
  const prefetched = page.waitForRequest((request) =>
    request.url().endsWith("/course-ratings.parquet"),
  );
  await page.goto("/rankings/instructors");
  await expect(
    page.getByRole("list", { name: "Instructor rankings" }),
  ).toBeVisible();
  await prefetched;
  await expect(page).toHaveURL(/\/rankings\/instructors/);
});

test("Course navigation prefetches without leaving an empty destination", async ({
  browserName,
  page,
}) => {
  await page.route(`${dataOrigin}/**/course-ratings.parquet`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  const prefetched = page.waitForRequest((request) =>
    request.url().endsWith("/course-ratings.parquet"),
  );
  await page.goto("/rankings/instructors");
  const instructorList = page.getByRole("list", {
    name: "Instructor rankings",
  });
  await expect(instructorList).toBeVisible();
  const link = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Courses" });
  await prefetched;
  await link.hover();
  await expect(page).toHaveURL(/\/rankings\/instructors/);
  await expect(instructorList).toBeVisible();

  const navigation = link.click();
  if (browserName === "chromium")
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

test("Course Details stream Rankings while Community is loading", async ({
  page,
}) => {
  test.skip(
    !process.env.TEST_CONTRIBUTIONS_POSTGRES_URL,
    "requires the browser contributions database",
  );
  const sql = postgres(browserContributionsUrl(), { max: 1 });
  let unlock = () => {};
  const unlocked = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  let locked = () => {};
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const blocker = sql.begin(async (transaction) => {
    await transaction.unsafe("LOCK TABLE reviews IN ACCESS EXCLUSIVE MODE");
    locked();
    await unlocked;
  });
  await acquired;
  try {
    await page.goto("/courses/comp/2000?community-stream=1", {
      timeout: 10_000,
      waitUntil: "commit",
    });
    await expect(page.getByText("Loading Community…")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rankings" })).toBeVisible();
  } finally {
    unlock();
    await blocker;
    await sql.end();
  }
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
});

test("blocked Worker creation preserves static Course identity and Community", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (options?.name === "public-course-query")
          throw new DOMException("Worker blocked", "SecurityError");
        super(url, options);
      }
    };
  });
  await page.goto("/courses/comp/2000");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await expect(page.getByText("Rankings are unavailable.")).toBeVisible();
});

test("unavailable WebAssembly preserves static Course identity and Community", async ({
  page,
}) => {
  await page.route("**/duckdb/*.wasm", (route) => route.abort());
  await page.goto("/courses/comp/2000");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await expect(page.getByText("Rankings are unavailable.")).toBeVisible();
});

test("Delivery CORS failure is explicit", async ({ page }) => {
  await page.route(`${dataOrigin}/**/courses.parquet`, (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-test-no-cors": "1",
      },
    }),
  );
  await page.goto("/rankings/courses?term=2510");
  await expect(
    page.getByRole("heading", { name: "Course rankings are unavailable" }),
  ).toBeVisible();
});

test("failed Parquet range delivery is explicit", async ({ page }) => {
  await page.route(`${dataOrigin}/**/course-ratings.parquet`, (route) =>
    route.fulfill({
      body: "range unavailable",
      headers: { "access-control-allow-origin": "*" },
      status: 416,
    }),
  );
  await page.goto("/rankings/courses?term=2510");
  await expect(
    page.getByRole("heading", { name: "Course rankings are unavailable" }),
  ).toBeVisible();
});

test("manifest integrity mismatch fails explicitly", async ({ page }) => {
  await page.route(`${dataOrigin}/**/manifest.json`, async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as {
      artifacts: Record<string, { sha256: string }>;
    };
    const courses = manifest.artifacts["courses.parquet"];
    if (courses) courses.sha256 = "a".repeat(64);
    await route.fulfill({ json: manifest, response });
  });
  await page.goto("/rankings/courses?term=2510");
  await expect(
    page.getByRole("heading", { name: "Course rankings are unavailable" }),
  ).toBeVisible();
});

test("corrupt Course Parquet fails explicitly", async ({ page }) => {
  await page.route(`${dataOrigin}/**/course-ratings.parquet`, (route) =>
    route.fulfill({
      body: "not parquet",
      contentType: "application/vnd.apache.parquet",
      headers: {
        "access-control-allow-origin": "*",
        "content-range": "bytes 0-10/11",
      },
      status: 206,
    }),
  );
  await page.goto("/rankings/courses?term=2510");
  await expect(
    page.getByRole("heading", { name: "Course rankings are unavailable" }),
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
  await expect(page.getByText("Rankings are unavailable.")).toBeVisible();
  expect(
    applicationRequests.some((url) =>
      /\/api\/(rankings|public-query)|\/rankings\/refresh/.test(url),
    ),
  ).toBe(false);
});
