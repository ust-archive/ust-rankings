import { expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  browserContributionsSchema,
  browserParticipantIds,
  browserReviewIds,
} from "../browser-contributions-fixture";

test("Review Order appears on every list, persists in the URL, and works on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/courses/comp/2000");

  const order = page.getByRole("combobox", { name: "Review Order" });
  const expectOrder = (label: "Top" | "Popular" | "Recent") =>
    expect(order).toHaveText(label);
  const instructorPath = await page
    .getByRole("link", { name: "Alpha Instructor" })
    .first()
    .getAttribute("href");
  if (!instructorPath) throw new Error("Expected fixture Instructor link");
  for (const path of [
    "/courses/comp/2000",
    instructorPath,
    "/courses/comp/2000/2510",
    "/courses/comp/2000/2510/l1",
  ]) {
    await page.goto(path);
    await expectOrder("Top");
  }

  await page.goto("/courses/comp/2000");
  await expectOrder("Top");
  await order.click();
  await page.getByRole("option", { name: "Popular" }).click();
  await expect(page).toHaveURL(/order=popular/);
  await page.reload();
  await expectOrder("Popular");

  await order.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/order=recent/);
  await expectOrder("Recent");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  for (const query of ["order=unknown", "order=popular&order=recent"]) {
    await page.goto(`/courses/comp/2000?${query}`);
    await expectOrder("Top");
  }
});

test("Review cards reorder without duplication before and after reaction changes", async ({
  page,
}) => {
  const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
  test.skip(!connection, "requires the disposable browser PostgreSQL fixture");
  const sql = postgres(connection as string, {
    max: 1,
    connection: { search_path: browserContributionsSchema },
  });
  try {
    await sql`DELETE FROM review_thumbs_votes WHERE review_id = ${browserReviewIds.recent}`;
    await sql`DELETE FROM review_emoji_reactions WHERE review_id = ${browserReviewIds.recent}`;
    await page.goto("/courses/comp/2000");

    const order = page.getByRole("combobox", { name: "Review Order" });
    const cards = page.locator('article[id^="review-"]');
    const reviewText = () => cards.locator(".prose").allTextContents();
    const expectOrder = async (
      value: "top" | "popular" | "recent",
      texts: string[],
    ) => {
      const label = `${value[0]?.toUpperCase()}${value.slice(1)}`;
      await order.click();
      await page.getByRole("option", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`order=${value}`));
      await expect.poll(reviewText).toEqual(texts);
      const ids = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.id),
      );
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    };

    await expect
      .poll(reviewText)
      .toEqual(["High quality Review", "Popular Review", "Recent Review"]);
    await expectOrder("popular", [
      "Popular Review",
      "High quality Review",
      "Recent Review",
    ]);
    await expectOrder("recent", [
      "Recent Review",
      "High quality Review",
      "Popular Review",
    ]);

    await sql`
      INSERT INTO review_thumbs_votes (user_id, review_id, state)
      SELECT id, ${browserReviewIds.recent}, 'up'
      FROM unnest(${browserParticipantIds.slice(0, 8)}::uuid[]) AS users(id)
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO review_emoji_reactions (user_id, review_id, code)
      VALUES (${browserParticipantIds[8]}, ${browserReviewIds.recent}, 'fire')
      ON CONFLICT DO NOTHING
    `;
    await page.goto("/courses/comp/2000");
    await expect
      .poll(reviewText)
      .toEqual(["Recent Review", "High quality Review", "Popular Review"]);
    const ids = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    );
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  } finally {
    await sql.end();
  }
});
