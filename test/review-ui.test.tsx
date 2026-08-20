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
  attribution: "attributed" as const,
  attributionCredit: "Captured Student",
  capturedDisplayName: "Captured Student",
  license: "CC BY 4.0" as const,
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
    'href="/reviews/00000000-0000-4000-8000-000000000144"',
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
  expect(markup).toContain("Public Display Name");
  expect(markup).toContain("Identity hidden");
  expect(markup).toContain("not anonymous to UST Rankings");
  expect(markup).toContain("authorized operator can link");
  expect(markup).toContain("Write");
  expect(markup).toContain("Preview");
  expect(markup).toContain("CC BY 4.0");
  expect(markup).toContain("non-exclusive site license");
  expect(markup).toContain("cannot be recalled");
  expect(markup).not.toMatch(/vote|reaction/i);
});

test("Identity-hidden public Review output redacts author names and emits CC credit metadata", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(
    <Reviews
      reviews={[
        {
          ...review,
          attribution: "identity-hidden",
          attributionCredit: "UST Rankings contributor",
          capturedDisplayName: "Must Never Render",
          license: "CC BY 4.0",
        },
      ]}
    />,
  );

  expect(markup).not.toContain("Must Never Render");
  expect(markup).toContain("Identity-hidden Review Revision");
  expect(markup).toContain("UST Rankings contributor");
  expect(markup).toContain("CC BY 4.0");
  expect(markup).toContain("Review permalink");
});

test("Review permalink remains stable across reassociation", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const href = `/reviews/${review.id}`;
  const courseMarkup = renderToStaticMarkup(<Reviews reviews={[review]} />);
  const instructorMarkup = renderToStaticMarkup(
    <Reviews
      reviews={[
        {
          ...review,
          course: undefined,
          instructorUuid: "00000000-0000-4000-8000-000000000046",
          termCode: undefined,
          section: undefined,
        },
      ]}
    />,
  );

  expect(courseMarkup).toContain(`href="${href}"`);
  expect(instructorMarkup).toContain(`href="${href}"`);
});

test("a Review author receives optimistic edit and withdrawal controls at the public seam", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(
    <Reviews
      editor={{
        courses: [{ coursePrefix: "COMP", courseNumber: "2000" }],
        instructors: [
          { instructorUuid: review.instructorUuid, name: "Ada Instructor" },
        ],
        contexts: [
          {
            course: review.course,
            instructorUuid: review.instructorUuid,
            termCode: "2510",
            section: "L1",
          },
        ],
      }}
      reviews={[{ ...review, viewerCanEdit: true }]}
    />,
  );

  expect(markup).toContain("Edit Review");
  expect(markup).toContain("Withdraw Review");
  expect(markup).toContain(`name="reviewId" value="${review.id}"`);
  expect(markup).toContain(
    `name="expectedRevisionId" value="${review.revisionId}"`,
  );
  expect(markup).toContain("Useful **labs**.");
  expect(markup).toContain(
    "Publishing this edit creates a new immutable Review Revision",
  );
});

test("historical Review editing preserves unsupported Context and blocks implicit publication", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const retiredInstructorUuid = "00000000-0000-4000-8000-000000000099";
  const markup = renderToStaticMarkup(
    <Reviews
      editor={{
        courses: [{ coursePrefix: "COMP", courseNumber: "2000" }],
        instructors: [
          { instructorUuid: review.instructorUuid, name: "Current Instructor" },
        ],
        contexts: [
          {
            course: review.course,
            instructorUuid: review.instructorUuid,
            termCode: "2510",
            section: "L1",
          },
        ],
      }}
      reviews={[
        {
          ...review,
          instructorUuid: retiredInstructorUuid,
          instructorAssociationStatus: "historical",
          viewerCanEdit: true,
        },
      ]}
    />,
  );

  expect(markup).toContain(`${retiredInstructorUuid}`);
  expect(markup).toContain('<option value="2510" selected="">');
  expect(markup).toContain('<option value="L1" selected="">');
  expect(markup).toContain(
    "This Review snapshot is no longer source-backed. Select supported Review Bases and Review Context before publishing.",
  );
  expect(markup).toMatch(
    /<button[^>]+disabled=""[^>]*>Publish Revision<\/button>/,
  );
});
