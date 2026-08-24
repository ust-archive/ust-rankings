import { expect, type Page, test } from "@playwright/test";

declare global {
  interface Window {
    viewTransitionCount: number;
  }
}

const rankingsUrl =
  "/rankings/courses?term=2510&preset=grade&activity=all&q=Bulk&settings=open";

function rankingLinks(page: Page) {
  return page.getByRole("list", { name: "Course rankings" }).getByRole("link");
}

async function loadEveryRanking(page: Page) {
  const results = rankingLinks(page);
  await expect(results).toHaveCount(100);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(results).toHaveCount(105);
  return results;
}

async function expectRankingRestored(
  page: Page,
  rankingUrl: string,
  rankingScroll: number,
) {
  await expect(page).toHaveURL(rankingUrl);
  await expect(rankingLinks(page)).toHaveCount(105);
  await expect(
    page.getByRole("searchbox", { name: "Search Courses" }),
  ).toHaveValue("Bulk");
  await expect(page.getByRole("combobox", { name: "Term" })).toContainText(
    "2025-26 Fall",
  );
  await expect(
    page.getByRole("radio", { name: /Grading-Focus'd/ }),
  ).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Courses" })).toContainText(
    "All",
  );
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(rankingScroll - 300);
}

test("entity navigation preserves Ranking history and provenance", async ({
  browserName,
  context,
  page,
}) => {
  await page.addInitScript(() => {
    const startViewTransition = document.startViewTransition.bind(document);
    Object.defineProperty(window, "viewTransitionCount", {
      configurable: true,
      value: 0,
      writable: true,
    });
    document.startViewTransition = (...args) => {
      window.viewTransitionCount += 1;
      return startViewTransition(...args);
    };
  });
  await page.goto(rankingsUrl);
  const results = await loadEveryRanking(page);
  const target = results.last();
  const title = await target.getByRole("heading").innerText();
  const href = await target.getAttribute("href");
  const rankingUrl = page.url();
  const rankingScroll = await page.evaluate(() => scrollY);

  expect(new URL(rankingUrl).searchParams.get("pages")).toBe("2");
  expect(new URL(rankingUrl).searchParams.get("cursor")).toBeTruthy();
  expect(rankingScroll).toBeGreaterThan(0);

  await page.route(
    `**${href}*`,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 750));
      await route.continue();
    },
    { times: 1 },
  );
  const navigation = target.click();
  if (browserName === "chromium")
    await expect(
      page.getByRole("progressbar", { name: "Loading page" }),
    ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "UST Rankings" }),
  ).toBeVisible();
  await expect(target).toBeVisible();
  await navigation;

  await expect(page).toHaveURL(href ?? "");
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  expect(await page.evaluate(() => window.viewTransitionCount)).toBeGreaterThan(
    0,
  );
  expect(context.pages()).toHaveLength(1);

  await page.goBack();
  await expectRankingRestored(page, rankingUrl, rankingScroll);

  await page.goForward();
  await expect(page).toHaveURL(href ?? "");
  await page.getByRole("button", { name: "Back" }).click();
  await expectRankingRestored(page, rankingUrl, rankingScroll);
});

test("direct, modified, reloaded, and restored Details visits have truthful provenance", async ({
  context,
  page,
}) => {
  await page.goto("/courses/comp/2000");
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  await page.getByRole("link", { name: "Alpha Instructor" }).first().click();
  await expect(page).toHaveURL(/\/instructors\//);
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/courses\/comp\/2000/i);
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);

  await page.goto(rankingsUrl);
  const result = (await loadEveryRanking(page)).last();
  const newPagePromise = context.waitForEvent("page");
  await result.click({ modifiers: ["Control"] });
  const newPage = await newPagePromise;
  await newPage.waitForLoadState();
  await expect(newPage.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/rankings\/courses/);
  await newPage.close();

  await result.click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
});

test("Details hierarchy receives a vertical transition", async ({ page }) => {
  await page.goto("/courses/comp/2000");
  await page.addStyleTag({
    content:
      ":root { --duration-enter: 2s; --duration-exit: 2s; --duration-move: 2s; }",
  });
  await page.getByRole("link", { name: "2025-26 Fall" }).click();
  await expect(page).toHaveURL(/\/courses\/comp\/2000\/2510/i);
  expect(
    await page.evaluate(() =>
      document
        .getAnimations()
        .some(
          (animation) =>
            Number(animation.effect?.getTiming().duration ?? 0) > 0,
        ),
    ),
  ).toBe(true);
});

test("hierarchical navigation works without View Transitions", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    });
  });
  const page = await context.newPage();
  await page.goto("/courses/comp/2000");
  await page.getByRole("link", { name: "2025-26 Fall" }).click();
  await expect(page).toHaveURL(/\/courses\/comp\/2000\/2510/i);
  await page.getByRole("link", { name: /COMP 2000 L1 \(1001\)/ }).click();
  await expect(page).toHaveURL(/\/courses\/comp\/2000\/2510\/l1/i);
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await context.close();
});

test("reduced motion keeps navigation functional without effective animation", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(rankingsUrl);
  await rankingLinks(page).first().click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      document
        .getAnimations()
        .every(
          (animation) =>
            Number(animation.effect?.getTiming().duration ?? 0) === 0,
        ),
    ),
  ).toBe(true);
  await context.close();
});
