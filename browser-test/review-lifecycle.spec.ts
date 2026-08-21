import { type BrowserContext, expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import postgres from "postgres";

const databaseUrl = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;
const authSecret = process.env.AUTH_SECRET;
const ready = Boolean(
  databaseUrl &&
    process.env.CONTRIBUTIONS_POSTGRES_URL &&
    authSecret &&
    process.env.REVIEW_POLICY_VERSION,
);
const userId = crypto.randomUUID();
const reviewId = crypto.randomUUID();
const revisionId = crypto.randomUUID();
const retiredInstructorUuid = crypto.randomUUID();
let sql: ReturnType<typeof postgres> | undefined;

async function addSignedSession(context: BrowserContext) {
  if (!authSecret) throw new Error("AUTH_SECRET is not configured");
  const cookieName = "authjs.session-token";
  const value = await encode({
    token: {
      userId,
      displayName: "Review Browser Student",
      onboarded: true,
    },
    secret: authSecret,
    salt: cookieName,
  });
  await context.addCookies([
    {
      name: cookieName,
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("authenticated Review lifecycle", () => {
  test.skip(
    !ready,
    "requires disposable migrated PostgreSQL and a test Auth.js secret",
  );

  test.beforeAll(async () => {
    sql = postgres(databaseUrl as string, { max: 1 });
    await sql`
      INSERT INTO contribution_users (id, status, public_display_name)
      VALUES (${userId}, 'active', 'Review Browser Student')
    `;
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`
      UPDATE reviews SET publication_state = 'withdrawn' WHERE id = ${reviewId}
    `;
    await sql`
      UPDATE contribution_users SET status = 'closed' WHERE id = ${userId}
    `;
    await sql.end();
  });

  test("historical Context is preserved until explicit reassociation and the permalink survives", async ({
    context,
    page,
  }) => {
    await addSignedSession(context);
    await page.goto("/rankings/courses");
    const coursePath = await page
      .locator('a[href^="/courses/"]')
      .first()
      .getAttribute("href");
    if (!coursePath || !sql) throw new Error("Course fixture is unavailable");
    const [, , coursePrefix, courseNumber] = coursePath.split("/");

    await page.goto(coursePath);
    await page.getByRole("button", { name: "Create a Review" }).click();
    const createDialog = page.getByRole("dialog", {
      name: "Create a Review",
    });
    const includeInstructor = createDialog.getByLabel(
      "Include Instructor Basis",
    );
    expect(await includeInstructor.isEnabled()).toBe(true);
    await includeInstructor.check();
    const currentInstructorUuid = await createDialog
      .getByLabel("Instructor Basis", { exact: true })
      .inputValue();
    const termCode = await createDialog
      .getByLabel("Term")
      .locator('option:not([value=""])')
      .first()
      .getAttribute("value");
    if (!termCode) throw new Error("Term fixture is unavailable");
    await createDialog.getByLabel("Term").selectOption(termCode);
    const sectionValue = await createDialog
      .getByLabel("Section")
      .locator('option:not([value=""])')
      .first()
      .getAttribute("value");
    if (!sectionValue) throw new Error("Section fixture is unavailable");
    await createDialog.getByRole("button", { name: "Cancel" }).click();

    await sql`
      INSERT INTO reviews (
        id, author_user_id, publication_state, course_prefix, course_number,
        instructor_uuid, instructor_association_status, term_code, section,
        current_revision_id
      ) VALUES (
        ${reviewId}, ${userId}, 'active', ${coursePrefix}, ${courseNumber},
        ${retiredInstructorUuid}, 'historical', ${termCode}, ${sectionValue}, NULL
      )
    `;
    await sql`
      INSERT INTO review_revisions (
        id, review_id, markdown, attribution, captured_display_name,
        policy_version
      ) VALUES (
        ${revisionId}, ${reviewId}, 'Historical Review Markdown.',
        'attributed', 'Review Browser Student', 'review-browser-test-v1'
      )
    `;
    await sql`
      INSERT INTO review_course_bases (revision_id, course_prefix, course_number)
      VALUES (${revisionId}, ${coursePrefix}, ${courseNumber})
    `;
    await sql`
      INSERT INTO review_instructor_bases (revision_id, instructor_uuid)
      VALUES (${revisionId}, ${retiredInstructorUuid})
    `;
    await sql`
      INSERT INTO review_contexts (revision_id, term_code, section)
      VALUES (${revisionId}, ${termCode}, ${sectionValue})
    `;
    await sql`
      UPDATE reviews SET current_revision_id = ${revisionId}
      WHERE id = ${reviewId}
    `;
    await page.reload();

    const permalink = page.locator(`a[href="/reviews/${reviewId}"]`);
    await expect(permalink).toHaveAttribute("href", `/reviews/${reviewId}`);
    await page.getByRole("button", { name: "Edit Review" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit your Review" });
    const term = dialog.getByLabel("Term");
    const section = dialog.getByLabel("Section");
    const publish = dialog.getByRole("button", { name: "Publish Revision" });
    await expect(term).toHaveValue(termCode);
    await expect(section).toHaveValue(sectionValue);
    await expect(
      dialog.getByRole("alert").filter({
        hasText: "This Review snapshot is no longer source-backed",
      }),
    ).toBeVisible();
    await expect(publish).toBeDisabled();

    await dialog
      .getByLabel("Instructor Basis", { exact: true })
      .selectOption(currentInstructorUuid);
    await expect(term).toHaveValue(termCode);
    await expect(section).toHaveValue(sectionValue);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(publish).toBeEnabled();

    await dialog
      .getByLabel("Review · Markdown")
      .fill("Explicitly reassociated Review.");
    await publish.click();
    await expect(page).toHaveURL(/review=published#reviews$/);
    await expect(page.locator(`a[href="/reviews/${reviewId}"]`)).toBeVisible();

    await page.goto(`/reviews/${reviewId}`);
    await expect(
      page.getByText("Explicitly reassociated Review."),
    ).toBeVisible();
    await expect(page.locator(`a[href="/reviews/${reviewId}"]`)).toBeVisible();

    await page.goto(coursePath);
    await page.getByRole("button", { name: "Withdraw Review" }).click();
    await expect(page).toHaveURL(/review=withdrawn#reviews$/);
    await page.goto(`/reviews/${reviewId}`);
    await expect(page.getByText("Explicitly reassociated Review.")).toHaveCount(
      0,
    );
    await expect(page.getByRole("heading", { name: "Review" })).toHaveCount(0);
  });
});
