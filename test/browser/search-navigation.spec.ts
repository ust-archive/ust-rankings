import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    releaseOldPage?: () => void;
  }
}
test("pending search cannot be superseded by an old Worker page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    window.Worker = class extends Native {
      paginationId?: number;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== "public-course-query") return;
        this.addEventListener("message", (event) => {
          if (event.data.id !== this.paginationId) return;
          event.stopImmediatePropagation();
          Object.assign(window, {
            releaseOldPage: () => {
              this.paginationId = undefined;
              this.dispatchEvent(
                new MessageEvent("message", { data: event.data }),
              );
            },
          });
        });
      }
      postMessage(
        message: { id: number; operation: string; input: { cursor?: string } },
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        if (message.operation === "courseRankings" && message.input.cursor)
          this.paginationId = message.id;
        super.postMessage(
          message,
          Array.isArray(options) ? { transfer: options } : options,
        );
      }
    };
  });
  let releaseSearch: () => void = () => {};
  let heldSearch = false;
  await page.route("**/rankings/courses?**", async (route) => {
    if (
      route.request().headers().rsc === "1" &&
      new URL(route.request().url()).searchParams.get("q") ===
        "no-matching-course-audit"
    ) {
      heldSearch = true;
      await new Promise<void>((resolve) => {
        releaseSearch = resolve;
      });
    }
    await route.continue();
  });
  await page.goto("/rankings/courses?term=2510&activity=all");
  const results = page.getByRole("list", { name: "Course rankings" });
  await expect(results.getByRole("link")).toHaveCount(100);
  await results.getByRole("link").last().scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releaseOldPage)))
    .toBe(true);
  await page
    .getByRole("searchbox", { name: "Search Courses" })
    .fill("no-matching-course-audit");
  await expect.poll(() => heldSearch).toBe(true);
  const before = page.url();
  try {
    await page.evaluate(() => window.releaseOldPage?.());
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(page.url()).toBe(before);
  } finally {
    releaseSearch();
  }
  await expect(page.getByText("No Rankings Found")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("no-matching-course-audit");
});
