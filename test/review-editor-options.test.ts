import { afterEach, expect, test, vi } from "vitest";
import type { PublicReview } from "@/lib/contributions/reviews";
import {
  ALPHA_INSTRUCTOR_UUID,
  RETIRED_INSTRUCTOR_UUID,
  serverIndexFixture,
} from "./server-index-fixture";

vi.mock("server-only", () => ({}));
afterEach(async () =>
  (await import("@/lib/server-index")).resetServerIndexForTests(),
);

const course = { coursePrefix: "COMP", courseNumber: "2000" };
const editor = { courses: [course], instructors: [], contexts: [] };
const review: PublicReview = {
  id: "10000000-0000-4000-8000-000000000001",
  revisionId: "20000000-0000-4000-8000-000000000001",
  course,
  instructorUuid: ALPHA_INSTRUCTOR_UUID,
  termCode: "2510",
  section: "L1",
  markdown: "Preserve my source-backed associations.",
  attribution: "attributed",
  attributionCredit: "Student",
  license: "CC BY 4.0",
  publishedAt: new Date("2026-08-20T12:00:00Z"),
  viewerCanEdit: true,
};

test("unavailable source validation leaves stored options unsupported", async () => {
  const { hydrateReviewEditorOptions } = await import(
    "@/app/courses/review-editor-options"
  );
  expect(await hydrateReviewEditorOptions(editor, [review])).toEqual(editor);
});

test("owned source-backed Review associations are available for editing on an entity page", async () => {
  (await import("@/lib/server-index")).installServerIndexForTests(
    serverIndexFixture(),
  );
  const { hydrateReviewEditorOptions } = await import(
    "@/app/courses/review-editor-options"
  );
  expect(await hydrateReviewEditorOptions(editor, [review])).toEqual({
    courses: [course],
    instructors: [
      { instructorUuid: ALPHA_INSTRUCTOR_UUID, name: "Alpha Instructor" },
    ],
    contexts: [
      {
        course,
        instructorUuid: ALPHA_INSTRUCTOR_UUID,
        termCode: "2510",
        section: "L1",
      },
    ],
  });
});

test("unsupported, remapped, unresolved, and other authors' snapshots do not become supported editor options", async () => {
  (await import("@/lib/server-index")).installServerIndexForTests(
    serverIndexFixture(),
  );
  const { hydrateReviewEditorOptions } = await import(
    "@/app/courses/review-editor-options"
  );
  for (const snapshot of [
    { ...review, section: "L2" },
    { ...review, instructorUuid: RETIRED_INSTRUCTOR_UUID },
    { ...review, instructorAssociationStatus: "needs-resolution" as const },
    { ...review, viewerCanEdit: false },
  ])
    expect(await hydrateReviewEditorOptions(editor, [snapshot])).toEqual(
      editor,
    );
});
