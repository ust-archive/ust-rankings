import { expect, test } from "@playwright/test";

const dataOrigin = "http://127.0.0.1:17832";
const alphaUuid = "00000000-0000-4000-8000-000000000001";

test("Schedule lists Course Offerings from the browser Worker", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510&q=Updated");
  await expect(
    page.getByRole("heading", { level: 1, name: "Course Offerings" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /COMP 2000/ })).toBeVisible();
  await expect(page.getByText(/1 Course Offerings/)).toBeVisible();
});

test("Course Schedule details load lazily from the pinned generation", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(dataOrigin)) requests.push(request.url());
  });
  await page.goto("/courses/comp/2000");
  await expect(
    page.getByRole("heading", { name: "Offerings & Classes" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "2025-26 Fall" })).toBeVisible();
  await expect(page.getByRole("link", { name: /L1 \(1001\)/ })).toBeVisible();
  const names = new Set(
    requests.map((url) => new URL(url).pathname.split("/").at(-1)),
  );
  expect(names).toContain("schedule-courses.parquet");
  expect(names).toContain("schedule-classes.parquet");
});

test("direct Course Offering and Class URLs preserve Community while Schedule resolves", async ({
  page,
}) => {
  await page.goto("/courses/comp/2000/2510");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Offerings & Classes" }),
  ).toBeVisible();

  await page.goto("/courses/comp/2000/2510/l1");
  await expect(
    page.getByRole("heading", { level: 1, name: "COMP 2000" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /COMP 2000 L1 \(1001\)/ }),
  ).toBeVisible();
  await expect(page.getByText(/Room 101|Room 102/).first()).toBeVisible();
});

test("Instructor Schedule Classes use the shared browser runtime", async ({
  page,
}) => {
  await page.goto(`/instructors/${alphaUuid}`);
  await expect(page.getByRole("heading", { name: "Classes" })).toBeVisible();
  await expect(page.getByRole("link", { name: /COMP 2000 L1/ })).toBeVisible();
});

test("Schedule failure is explicit and does not disable Rankings or Community", async ({
  page,
}) => {
  await page.route(`${dataOrigin}/**/schedule-courses.parquet`, (route) =>
    route.abort(),
  );
  await page.goto("/courses/comp/2000");
  await expect(
    page.getByRole("heading", { name: "Schedule is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rankings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await page.goto("/rankings/courses?term=2510&q=Bulk");
  await expect(
    page.getByRole("list", { name: "Course rankings" }).getByRole("link"),
  ).toHaveCount(100);
});

test("calendar subscription routes are removed", async ({ request }) => {
  expect(
    (await request.get("/schedule/calendar.ics?term=2510&class=1001")).status(),
  ).toBe(404);
  expect(
    (await request.get("/api/calendar?term=2510&number=1001")).status(),
  ).toBe(404);
});
