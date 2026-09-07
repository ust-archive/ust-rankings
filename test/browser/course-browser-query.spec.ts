import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { browserContributionsUrl } from "../browser-contributions-fixture";

const dataOrigin = "http://127.0.0.1:17832";

declare global {
  interface Window {
    navigationClickAt: number;
    viewTransitionDelay: number;
  }
}

test("DuckDB browser assets are versioned and immutable", async ({ page }) => {
  const wasm = page.waitForRequest(
    /\/duckdb\/1\.32\.0\/duckdb-(?:eh|mvp)\.wasm$/,
    { timeout: 5_000 },
  );
  await page.goto("/rankings/courses");
  const request = await wasm;
  const response = await page.request.head(request.url());
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
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

test("Course search accepts compact Course Codes", async ({ page }) => {
  await page.goto("/rankings/courses?term=2510");
  await expect(
    page.getByRole("list", { name: "Course rankings" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search Courses" });
  await search.fill("COMP1000");
  expect(new URL(page.url()).searchParams.get("q")).toBe("COMP1000");
  const results = page
    .getByRole("list", { name: "Course rankings" })
    .getByRole("link");
  await expect(results).toHaveCount(1);
  await expect(results).toContainText("COMP 1000");
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
  const scheduleCard = page
    .getByRole("heading", { name: "Offerings & Classes" })
    .locator("xpath=../..");
  await expect(scheduleCard.getByText(/waitlisted/)).toHaveCount(0);
  await expect(scheduleCard.getByText(/\d{4}-\d{2}-\d{2}/)).toHaveCount(0);
});

test("counterpart Ranking navigation does not wait for cold browser data", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const startViewTransition = document.startViewTransition.bind(document);
    window.viewTransitionDelay = Number.POSITIVE_INFINITY;
    document.startViewTransition = (...args) => {
      window.viewTransitionDelay = performance.now() - window.navigationClickAt;
      return startViewTransition(...args);
    };
  });
  await page.route(`${dataOrigin}/**/course-ratings.parquet`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.route("**/rankings/courses?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.goto("/rankings/instructors");
  await expect(
    page.getByRole("list", { name: "Instructor rankings" }),
  ).toBeVisible();
  const link = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Courses" });

  await link.evaluate((element) => {
    window.navigationClickAt = performance.now();
    (element as HTMLElement).click();
  });

  await expect
    .poll(() => page.evaluate(() => window.viewTransitionDelay), {
      timeout: 5_000,
    })
    .not.toBe(Number.POSITIVE_INFINITY);
  expect(await page.evaluate(() => window.viewTransitionDelay)).toBeLessThan(
    1_000,
  );
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
    await expect(page.getByLabel("Loading Community")).toBeVisible();
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
