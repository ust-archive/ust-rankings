import { expect, test } from "@playwright/test";

const waitlistCard = (page: import("@playwright/test").Page) =>
  page.locator("[data-waitlist-course='WAIT 3000']");

test("Waitlist Evidence exposes the current Term and independent Course cards", async ({
  page,
}) => {
  await page.goto("/waitlist");

  await expect(
    page.getByRole("heading", { level: 1, name: "Historical Queue Evidence" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Waitlist Evidence" }),
  ).toBeVisible();
  await expect(
    page.getByText("Current supported Term: 2025-26 Fall"),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search Waitlist Evidence Courses" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Term" })).toHaveCount(0);

  const card = waitlistCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /WAIT 3000/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await card.getByRole("button", { name: /WAIT 3000/ }).click();
  await expect(card.getByRole("button", { name: /WAIT 3000/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(card.getByText("L1")).toBeVisible();
  await expect(card.getByText("Lecture")).toBeVisible();
  await expect(card.getByText("40 / 30", { exact: true })).toBeVisible();
  await expect(card.getByText("8", { exact: true })).toBeVisible();
  await expect(card.getByText(/Queue Instructor/)).toHaveCount(2);
  await expect(
    card.getByRole("checkbox", { name: /Require L1/ }),
  ).toBeVisible();

  await card.getByRole("checkbox", { name: /Require L1/ }).check();
  await card
    .getByRole("spinbutton", { name: "Queue position for WAIT 3000 L1" })
    .fill("5");
  await card.getByRole("checkbox", { name: /Require T1/ }).check();
  await card
    .getByRole("spinbutton", { name: "Queue position for WAIT 3000 T1" })
    .fill("3");
  await card
    .getByRole("button", { name: "Calculate Historical Queue Evidence" })
    .click();
  const result = card.getByRole("region", {
    name: "Historical Queue Evidence result",
  });
  await expect(result).toBeVisible();
  await expect(
    result.getByText(/Not an individual enrollment probability/),
  ).toBeVisible();
  await expect(result.getByText(/% ±\d+ pp \(\d+–\d+%\)/)).toBeVisible();

  await result.getByText("Evidence details").click();
  await expect(result.getByText(/Exact comparable history/)).toBeVisible();
  await expect(result.getByText(/Smoothing formula/)).toBeVisible();
  await expect(result.getByText(/Source and model/)).toBeVisible();
});

test("Waitlist cards expose independent unsupported Classes and empty-plan validation", async ({
  page,
}) => {
  await page.goto("/waitlist");
  const comp = page.locator("[data-waitlist-course='COMP 2000']");
  const wait = waitlistCard(page);
  await comp.getByRole("button", { name: /COMP 2000/ }).click();
  await wait.getByRole("button", { name: /WAIT 3000/ }).click();
  await expect(comp.getByRole("button", { name: /COMP 2000/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(wait.getByRole("button", { name: /WAIT 3000/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    comp.getByText(/No waitlist is currently reported/),
  ).toBeVisible();
  await expect(comp.getByRole("checkbox")).toHaveCount(1);
  await expect(
    comp.getByRole("checkbox", { name: /Require L1/ }),
  ).toBeDisabled();
  await wait
    .getByRole("button", { name: "Calculate Historical Queue Evidence" })
    .click();
  await expect(
    wait.getByRole("alert").filter({ hasText: /Select at least one/ }),
  ).toBeVisible();
});

test("Waitlist cards retain browser-only plans through filtering and validate positions", async ({
  page,
}) => {
  await page.goto("/waitlist");
  const card = waitlistCard(page);
  await card.getByRole("button", { name: /WAIT 3000/ }).click();
  await card.getByRole("checkbox", { name: /Require L1/ }).check();
  const position = card.getByRole("spinbutton", {
    name: "Queue position for WAIT 3000 L1",
  });
  await position.fill("9");
  await expect(
    card.getByText(/cannot exceed the current wait of 8/),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Calculate Historical Queue Evidence" }),
  ).toBeDisabled();
  expect(page.url()).not.toContain("9");

  await position.fill("5");
  await expect(
    card.getByRole("button", { name: "Calculate Historical Queue Evidence" }),
  ).toBeEnabled();
  const search = page.getByRole("searchbox", {
    name: "Search Waitlist Evidence Courses",
  });
  await search.fill("MATH");
  await expect(card).toHaveCount(0);
  await search.fill("WAIT");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /WAIT 3000/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(position).toHaveValue("5");

  await page.reload();
  const freshCard = waitlistCard(page);
  await expect(
    freshCard.getByRole("button", { name: /WAIT 3000/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    freshCard.getByRole("spinbutton", {
      name: "Queue position for WAIT 3000 L1",
    }),
  ).toHaveCount(0);
});
