import { expect, test } from "@playwright/test";
import { PNG_1x1 } from "../attachment-fixtures";

test("failed uploads notify and release slots without losing text or successful inline attachments", async ({
  page,
  baseURL,
}) => {
  const token = process.env.TEST_REVIEW_SESSION_TOKEN;
  test.skip(!token, "requires an authenticated disposable local User");
  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: token as string,
      url: baseURL as string,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const realDisabledUploads =
    process.env.TEST_REVIEW_REAL_DISABLED_UPLOADS === "1";
  if (!realDisabledUploads)
    await page.route("**/api/attachments/uploads", (route) =>
      route.fulfill({ status: 503, body: "Uploads unavailable" }),
    );
  await page.goto(
    process.env.TEST_REVIEW_COMPOSER_PATH ?? "/courses/comp/2000",
  );
  const createReview = page.getByRole("button", { name: "CREATE A REVIEW" });
  await expect(async () => {
    await createReview.click();
    await expect(
      page.getByRole("heading", { name: "Create a Review", exact: true }),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const draft = "Keep this unpublished draft.";
  await page.getByRole("textbox", { name: "editable markdown" }).fill(draft);
  const fileInput = page.getByLabel("Add Attachments");
  const attachmentPayload = page.locator('input[name="attachments"]');
  for (const _ of [1, 2, 3, 4]) {
    const reserved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/attachments/uploads",
    );
    await fileInput.setInputFiles({
      name: "recovery.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    expect((await reserved).status()).toBe(503);
    await expect(
      page.getByText("recovery.png could not be uploaded.").last(),
    ).toBeVisible();
    await expect(page.getByText(/recovery\.png ·/)).toHaveCount(0);
    await expect(fileInput).toBeEnabled();
    await expect(attachmentPayload).toHaveValue("[]");
  }
  await expect(
    page.getByRole("button", { name: /^Retry |^Remove / }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "CREATE A REVIEW" }).click();
  await expect(
    page.getByRole("textbox", { name: "editable markdown" }),
  ).toContainText(draft);
  await expect(fileInput).toBeEnabled();

  // Storage is the external seam: no object upload or Review submission occurs.
  await page.unroute("**/api/attachments/uploads");
  const origin = new URL(baseURL as string).origin;
  await page.route("**/api/attachments/uploads", (route) =>
    route.fulfill({
      json: {
        intentId: "local-intent",
        uploadUrl: `${origin}/local-upload`,
        uploadHeaders: {},
      },
    }),
  );
  let finishUpload: ((status: number) => Promise<void>) | undefined;
  let transferCount = 0;
  await page.route("**/local-upload", (route) => {
    transferCount += 1;
    finishUpload = (status) => route.fulfill({ status });
  });
  const completeUrl = "**/api/attachments/uploads/local-intent/complete";
  await page.route(completeUrl, (route) =>
    route.fulfill({
      json: { id: "00000000-0000-4000-8000-000000000081", kind: "image" },
    }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/attachments/"),
    (route) => route.fulfill({ contentType: "image/png", body: PNG_1x1 }),
  );
  await fileInput.setInputFiles({
    name: "inline.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });
  await expect(
    page.getByText("inline.png · pending", { exact: true }),
  ).toBeVisible();
  await expect(attachmentPayload).toHaveValue("[]");
  await expect.poll(() => transferCount).toBe(1);
  await finishUpload?.(200);
  await expect(
    page.getByText("inline.png · ready", { exact: true }),
  ).toBeVisible();
  const readyPayload = await attachmentPayload.inputValue();
  const attachments = JSON.parse(readyPayload) as { id: string }[];
  await page.getByRole("tab", { name: "Markdown", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  const inlineDraft = `${draft}\n\n![inline](/attachments/${attachments[0].id})`;
  await source.fill(inlineDraft);

  const failedId = await page.evaluate(() => {
    const id = "00000000-0000-4000-8000-000000000082";
    const original = crypto.randomUUID.bind(crypto);
    let first = true;
    crypto.randomUUID = () => {
      if (!first)
        return original() as `${string}-${string}-${string}-${string}-${string}`;
      first = false;
      return id;
    };
    return id;
  });
  await fileInput.setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });
  await expect(page.getByText("broken.png · pending")).toBeVisible();
  const referencedPendingDraft = `${inlineDraft}\n\n![failed](/attachments/${failedId})`;
  await source.fill(referencedPendingDraft);
  await expect(attachmentPayload).toHaveValue(readyPayload);
  await expect.poll(() => transferCount).toBe(2);
  await finishUpload?.(500);
  await expect(
    page.getByText("broken.png could not be uploaded."),
  ).toBeVisible();
  await expect(page.getByText(/broken\.png ·/)).toHaveCount(0);
  await expect(source).toHaveValue(referencedPendingDraft);
  await expect(attachmentPayload).toHaveValue(readyPayload);
  await expect(page.getByText("inline.png · ready")).toBeVisible();
  await expect(fileInput).toBeEnabled();

  await page.unroute(completeUrl);
  await page.route(completeUrl, (route) =>
    route.fulfill({ status: 503, body: "Validation unavailable" }),
  );
  await fileInput.setInputFiles({
    name: "completion.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });
  await expect(page.getByText("completion.png · pending")).toBeVisible();
  await expect.poll(() => transferCount).toBe(3);
  await finishUpload?.(200);
  await expect(
    page.getByText("completion.png could not be uploaded."),
  ).toBeVisible();
  await expect(page.getByText(/completion\.png ·/)).toHaveCount(0);
  await expect(source).toHaveValue(referencedPendingDraft);
  await expect(attachmentPayload).toHaveValue(readyPayload);
  await expect(page.getByText("inline.png · ready")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Retry |^Remove / }),
  ).toHaveCount(0);
});
