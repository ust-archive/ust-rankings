import { expect, type Page, test } from "@playwright/test";

const dataOrigin = "http://127.0.0.1:17832";

async function waitForWorker(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as Window & { __publicQueryWorker?: Worker })
            .__publicQueryWorker,
        ),
      ),
    )
    .toBe(true);
}

async function queryWorker(
  page: Page,
  operation: "waitlistSearch" | "waitlistPlan",
  input: unknown,
) {
  return page.evaluate(
    ({ operation, input }) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = (window as Window & { __publicQueryWorker?: Worker })
          .__publicQueryWorker;
        if (!worker) {
          reject(new Error("Public query Worker was not created."));
          return;
        }
        const id = Math.floor(Math.random() * 1_000_000) + 1;
        const onMessage = (event: MessageEvent) => {
          if (event.data?.id !== id) return;
          worker.removeEventListener("message", onMessage);
          resolve(event.data.ok ? event.data.output : event.data.error);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({
          id,
          baseUrl: "http://127.0.0.1:17832",
          operation,
          input,
        });
      }),
    { operation, input },
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    class PublicQueryWorker extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (
          window as Window & { __publicQueryWorker?: Worker }
        ).__publicQueryWorker = this;
      }
    }
    window.Worker = PublicQueryWorker;
  });
});

test("Waitlist search and Plan use the typed browser Worker contract", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(dataOrigin)) requests.push(request.url());
  });
  await page.goto("/schedule?term=2510&q=Waitlist");
  await expect(
    page.getByRole("heading", { name: "Course Offerings" }),
  ).toBeVisible();
  await waitForWorker(page);
  const search = await queryWorker(page, "waitlistSearch", { search: "WAIT" });
  expect(search).toMatchObject({
    term: { termCode: "2510", season: "Fall" },
    total: 1,
  });
  expect((search.results as Array<Record<string, unknown>>)[0]).toMatchObject({
    courseCode: "WAIT 3000",
  });
  expect(
    requests.some((url) => url.endsWith("/waitlist-evidence.parquet")),
  ).toBe(false);
  const result = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "WAIT",
    courseNumber: "3000",
    classes: [
      { section: "L1", position: 5 },
      { section: "T1", position: 3 },
    ],
  });
  expect(result).toMatchObject({
    status: "supported",
    term: { termCode: "2510" },
    course: "WAIT 3000",
  });
  expect(result.components).toHaveLength(2);
  expect(result.joint).toMatchObject({ samples: 1, successes: 0 });
  expect(result.components).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "LEC",
        activationHours: 48,
        historical: expect.objectContaining({ successes: 1 }),
      }),
      expect.objectContaining({
        type: "TUT",
        historical: expect.objectContaining({ successes: 0 }),
      }),
    ]),
  );
  expect(result.smoothing).toMatchObject({ priorWeight: 4 });
  expect(
    new Set(requests.map((url) => new URL(url).pathname.split("/").at(-1))),
  ).toContain("waitlist-evidence.parquet");
  const zeroExact = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "MATH",
    courseNumber: "1000",
    classes: [
      { section: "L1", position: 2 },
      { section: "T1", position: 1 },
    ],
  });
  expect(zeroExact).toMatchObject({
    status: "supported",
    exactHistoryCount: 0,
  });
  expect(Number(zeroExact.broaderHistoryCount)).toBeGreaterThan(0);
  const favorable = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "MATH",
    courseNumber: "1000",
    classes: [{ section: "L1", position: 2 }],
  });
  expect(favorable.joint).toMatchObject({ successes: 1 });
});

test("Waitlist positions stay in the Worker input and invalid plans are typed", async ({
  page,
}) => {
  await page.goto("/schedule?term=2510");
  await expect(
    page.getByRole("heading", { name: "Course Offerings" }),
  ).toBeVisible();
  await waitForWorker(page);
  const result = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "WAIT",
    courseNumber: "3000",
    classes: [{ section: "L1", position: 999 }],
  });
  expect(result).toMatchObject({
    status: "unsupported",
    reason: "stale-position",
  });
  expect(page.url()).not.toContain("999");
  const duplicate = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "WAIT",
    courseNumber: "3000",
    classes: [
      { section: "L1", position: 1 },
      { section: "l1", position: 2 },
    ],
  });
  expect(duplicate).toMatchObject({
    status: "unsupported",
    reason: "duplicate-class",
  });
  const unsupportedTerm = await queryWorker(page, "waitlistPlan", {
    termCode: "2610",
    coursePrefix: "WAIT",
    courseNumber: "3000",
    classes: [{ section: "L1", position: 1 }],
  });
  expect(unsupportedTerm).toMatchObject({
    status: "unsupported",
    reason: "unsupported-term",
  });
  const nonWaitlisted = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "COMP",
    courseNumber: "2000",
    classes: [{ section: "L1", position: 1 }],
  });
  expect(nonWaitlisted).toMatchObject({
    status: "unsupported",
    reason: "non-waitlisted",
  });
  const inactive = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "COMP",
    courseNumber: "2000",
    classes: [{ section: "T1", position: 1 }],
  });
  expect(inactive).toMatchObject({ status: "unsupported", reason: "inactive" });
  await page.route(`${dataOrigin}/**/waitlist-evidence.parquet`, (route) =>
    route.abort(),
  );
  const unavailable = await queryWorker(page, "waitlistPlan", {
    termCode: "2510",
    coursePrefix: "WAIT",
    courseNumber: "3000",
    classes: [{ section: "L1", position: 1 }],
  });
  expect(unavailable).toMatchObject({ code: "unavailable" });
  await page.goto("/rankings/courses");
  await expect(
    page.getByRole("list", { name: "Course rankings" }),
  ).toBeVisible();
});
