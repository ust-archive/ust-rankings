import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    heldRankingPage?: () => void;
    rankingPageReleased: boolean;
  }
}

for (const destination of ["search", "route"] as const) {
  test(`a delayed ranking page cannot overwrite a new ${destination}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        private paginationId?: number;

        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (options?.name !== "public-course-query") return;
          this.addEventListener("message", (event) => {
            if (event.data.id !== this.paginationId) return;
            event.stopImmediatePropagation();
            window.heldRankingPage = () => {
              this.paginationId = undefined;
              this.dispatchEvent(
                new MessageEvent("message", { data: event.data }),
              );
              window.rankingPageReleased = true;
            };
          });
        }

        postMessage(
          message: {
            id: number;
            operation: string;
            input: { cursor?: string };
          },
          options?: Transferable[] | StructuredSerializeOptions,
        ) {
          if (message.operation === "courseRankings" && message.input.cursor)
            this.paginationId ??= message.id;
          super.postMessage(
            message,
            Array.isArray(options) ? { transfer: options } : options,
          );
        }
      };
    });
    await page.goto("/rankings/courses?term=2510&activity=all");
    const results = page.getByRole("list", { name: "Course rankings" });
    await expect(results.getByRole("link")).toHaveCount(100);
    await results.getByRole("link").last().scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.heldRankingPage)))
      .toBe(true);

    if (destination === "search") {
      await page
        .getByRole("searchbox", { name: "Search Courses" })
        .fill("no-matching-course-audit");
      await expect(page.getByText("No Rankings Found")).toBeVisible();
    } else {
      await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link", { name: "Schedule", exact: true })
        .click();
      await expect(page).toHaveURL(/\/schedule$/);
    }
    const currentUrl = page.url();
    await page.evaluate(() => window.heldRankingPage?.());
    await expect
      .poll(() => page.evaluate(() => window.rankingPageReleased))
      .toBe(true);
    // Allow React's asynchronous completion to reach the browser history seam.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(page.url()).toBe(currentUrl);
    await expect(page.getByText("Invalid ranking query")).toHaveCount(0);
    await expect(
      page.getByText("More rankings could not be loaded"),
    ).toHaveCount(0);
  });
}
