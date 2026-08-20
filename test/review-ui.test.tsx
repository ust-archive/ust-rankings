import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

const review = {
  id: "00000000-0000-4000-8000-000000000144",
  revisionId: "00000000-0000-4000-8000-000000000244",
  coursePrefix: "COMP",
  courseNumber: "2000",
  markdown:
    "Useful **labs**. <script>alert('xss')</script> ![tracking](https://evil.example/pixel.png) [bad](javascript:alert(1))",
  capturedDisplayName: "Captured Student",
  publishedAt: new Date("2026-08-20T12:00:00.000Z"),
};

test("public Review Markdown is attributed and rendered without raw HTML or remote images", async () => {
  const { CourseReviews } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(<CourseReviews reviews={[review]} />);
  expect(markup).toContain("Captured Student");
  expect(markup).toContain("<strong>labs</strong>");
  expect(markup).not.toContain("<script");
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("evil.example");
  expect(markup).not.toContain('href="javascript:');
  expect(markup.match(/Useful/g)).toHaveLength(1);
});

test("Course Review composer states captured attribution and licensing terms", async () => {
  const { CourseReviewComposer } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(
    <CourseReviewComposer coursePrefix="COMP" courseNumber="2000" />,
  );
  expect(markup).toContain("Publish Revision");
  expect(markup).toContain("Attributed Review Revision");
  expect(markup).toContain("Public Display Name");
  expect(markup).toContain("CC BY 4.0");
  expect(markup).toContain("non-exclusive site license");
  expect(markup).not.toMatch(/vote|reaction/i);
});
