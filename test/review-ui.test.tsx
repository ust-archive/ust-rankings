import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

const review = {
  id: "00000000-0000-4000-8000-000000000144",
  revisionId: "00000000-0000-4000-8000-000000000244",
  course: { coursePrefix: "COMP", courseNumber: "2000" },
  instructorUuid: "00000000-0000-4000-8000-000000000045",
  termCode: "2510",
  section: "L1",
  markdown:
    "Useful **labs**. <script>alert('xss')</script> ![tracking](https://evil.example/pixel.png) [bad](javascript:alert(1))",
  capturedDisplayName: "Captured Student",
  publishedAt: new Date("2026-08-20T12:00:00.000Z"),
  instructorAssociationStatus: "needs-resolution" as const,
};

test("public Review renders equal Bases, secondary Context, and safe Markdown once", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(<Reviews reviews={[review]} />);
  expect(markup).toContain("Captured Student");
  expect(markup).toContain("Course Basis · COMP 2000");
  expect(markup).toContain(`Instructor Basis · ${review.instructorUuid}`);
  expect(markup).toContain("Review Context · Term 2510 · Section L1");
  expect(markup).toContain("needs resolution");
  expect(markup).toContain("has not been guessed or reassigned");
  expect(markup).toContain("<strong>labs</strong>");
  expect(markup).not.toContain("<script");
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("evil.example");
  expect(markup).not.toContain('href="javascript:');
  expect(markup).toContain(
    'href="/courses/COMP/2000#review-00000000-0000-4000-8000-000000000144"',
  );
  expect(markup.match(/Useful/g)).toHaveLength(1);

  const historical = renderToStaticMarkup(
    <Reviews
      reviews={[
        {
          ...review,
          id: "00000000-0000-4000-8000-000000000145",
          instructorAssociationStatus: "historical",
        },
      ]}
    />,
  );
  expect(historical).toContain(
    "Historical Instructor association retained after an identity merge.",
  );
});

test("Instructor-only composer Terms use only matching source-backed Context choices", async () => {
  const { ReviewComposer } = await import("@/app/courses/course-reviews");
  const instructorUuid = review.instructorUuid;
  const markup = renderToStaticMarkup(
    <ReviewComposer
      contexts={[
        { instructorUuid, termCode: "2510" },
        {
          course: { coursePrefix: "COMP", courseNumber: "2000" },
          instructorUuid,
          termCode: "2430",
        },
      ]}
      courses={[{ coursePrefix: "COMP", courseNumber: "2000" }]}
      initialInstructorUuid={instructorUuid}
      instructors={[{ instructorUuid, name: "Ada Instructor" }]}
    />,
  );
  expect(markup).toContain('<option value="2510">2510</option>');
  expect(markup).not.toContain('<option value="2430">2430</option>');
});

test("responsive Review composer exposes dependent Basis and Context controls and publication terms", async () => {
  const { ReviewComposer } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(
    <ReviewComposer
      contexts={[
        {
          course: { coursePrefix: "COMP", courseNumber: "2000" },
          instructorUuid: review.instructorUuid,
          termCode: "2510",
          section: "L1",
        },
      ]}
      courses={[{ coursePrefix: "COMP", courseNumber: "2000" }]}
      initialCourse={{ coursePrefix: "COMP", courseNumber: "2000" }}
      instructors={[
        { instructorUuid: review.instructorUuid, name: "Ada Instructor" },
      ]}
    />,
  );
  expect(markup).toContain("one or two co-equal Review Bases");
  expect(markup).toContain('aria-label="Course Basis"');
  expect(markup).toContain('aria-label="Instructor Basis"');
  expect(markup).toContain("Review Context");
  expect(markup).toContain("Section requires a Course Basis and Term");
  expect(markup).toContain("Publish Revision");
  expect(markup).toContain("Attributed Review Revision");
  expect(markup).toContain("Public Display Name");
  expect(markup).toContain("CC BY 4.0");
  expect(markup).toContain("non-exclusive site license");
  expect(markup).not.toMatch(/vote|reaction/i);
});
