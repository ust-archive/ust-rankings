import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

for (const entity of ["Course", "Instructor"] as const) {
  for (const signedIn of [false, true]) {
    test(`${entity} ${signedIn ? "signed-in" : "anonymous"} production prefetch avoids community reads`, async ({
      page,
      context,
    }, testInfo) => {
      const logPath = process.env.PREFETCH_RUNTIME_LOG;
      test.skip(
        !logPath,
        "requires the production prefetch configuration and an isolated healthy database",
      );
      if (signedIn) {
        const secret = process.env.PREFETCH_AUTH_SECRET;
        test.skip(!secret, "requires the local test server's AUTH_SECRET");
        const token = await encode({
          secret: secret as string,
          salt: "__Secure-authjs.session-token",
          token: { userId: "20000000-0000-4000-8000-000000000001" },
        });
        await context.addCookies([
          {
            name: "__Secure-authjs.session-token",
            value: token,
            domain: new URL(process.env.PREFETCH_BASE_URL as string).hostname,
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }
      const offset = (await readFile(logPath as string, "utf8")).length;
      const events = async () =>
        (await readFile(logPath as string, "utf8"))
          .slice(offset)
          .split(/\r?\n/)
          .flatMap((line) => {
            try {
              const value = JSON.parse(line.slice(line.indexOf("{")));
              return value.event === "database-operation" ? [value] : [];
            } catch {
              return [];
            }
          });
      const detailRequests: string[] = [];
      const publicFiles = new Set<string>();
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.origin === new URL(page.url()).origin &&
          /^\/(courses|instructors)\//.test(url.pathname)
        )
          detailRequests.push(url.pathname);
        if (url.pathname.endsWith(".parquet")) publicFiles.add(url.pathname);
      });
      // Preserve the exact real Delivery Generation used by this run as test evidence.
      page.on("response", async (response) => {
        const pathname = new URL(response.url()).pathname;
        if (
          pathname.endsWith("/latest.json") ||
          pathname.endsWith("/manifest.json")
        ) {
          const manifest = await response.body();
          const name = pathname.endsWith("/latest.json")
            ? "delivery-pointer"
            : "delivery-generation";
          await writeFile(testInfo.outputPath(`${name}.json`), manifest);
          await testInfo.attach(name, {
            body: manifest,
            contentType: "application/json",
          });
        }
      });
      await page.goto(
        `/rankings/${entity === "Course" ? "courses" : "instructors"}?activity=all&preset=grade`,
      );
      const links = page
        .getByRole("list", { name: `${entity} rankings` })
        .getByRole("link");
      await expect(links.first()).toBeVisible();
      await links.last().scrollIntoViewIfNeeded();
      await links.first().scrollIntoViewIfNeeded();
      const target = links.first();
      await target.hover();
      await target.focus();
      await expect
        .poll(() =>
          [...publicFiles].some((path) =>
            path.endsWith("/schedule-courses.parquet"),
          ),
        )
        .toBe(true);
      // Allow the browser's viewport/intent prefetch scheduler to execute.
      await page.waitForTimeout(1500);
      expect(detailRequests).toEqual([]);
      expect(
        (await events()).filter(
          (event) =>
            event.phase === "attempt" &&
            !event.operation.startsWith("accounts.") &&
            !event.operation.startsWith("operator."),
        ),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("rankings.png") });
      const href = await target.getAttribute("href");
      await target.press("Enter");
      await expect(page).toHaveURL(
        new URL(href as string, process.env.PREFETCH_BASE_URL).href,
      );
      await expect
        .poll(async () =>
          (await events())
            .filter(
              (event) =>
                event.phase === "complete" && event.outcome === "success",
            )
            .map((event) => event.operation),
        )
        .toEqual(
          expect.arrayContaining([
            "reviews.listReviews",
            "signals.readSignals",
          ]),
        );
      expect(
        (await events()).filter((event) => event.outcome === "error"),
      ).toEqual([]);
      await expect(
        page.getByRole("combobox", { name: "Review Order" }),
      ).toBeVisible();
      const completed = (await events()).filter(
        (event) =>
          event.phase === "complete" &&
          event.operation === "reviews.listReviews",
      );
      expect(completed.at(-1)).toMatchObject({
        caller: entity.toLowerCase(),
        authentication: signedIn ? "authenticated" : "anonymous",
      });
      if (signedIn)
        expect(
          (await events()).some((event) => event.caller === "account.header"),
        ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("detail.png") });
    });
  }
}
