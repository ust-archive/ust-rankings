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
  expect(markup).toContain("COMP 2000");
  expect(markup).toContain("2510");
  expect(markup).toContain("L1");
  expect(markup).not.toContain("Course Basis");
  expect(markup).toContain("needs resolution");
  expect(markup).toContain("has not been guessed or reassigned");
  expect(markup).toContain("<strong>labs</strong>");
  expect(markup).not.toContain("<script>alert");
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("evil.example");
  expect(markup).not.toContain('href="javascript:');
  expect(markup).toContain(
    'href="/reviews/00000000-0000-4000-8000-000000000144"',
  );
  expect(markup.match(/Useful/g)).toHaveLength(1);

  const broken = renderToStaticMarkup(
    <Reviews reviews={[{ ...review, markdown: "Line one\nLine two" }]} />,
  );
  expect(broken).toMatch(/Line one<br\s*\/?>\s*Line two/);

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
          attributionCredit: "Anonymous Reviewer",
          capturedDisplayName: "Must Never Render",
          license: "CC BY 4.0",
        },
      ]}
    />,
  );

  expect(markup).not.toContain("Must Never Render");
  expect(markup).not.toContain("Identity-hidden Review Revision");
  expect(markup).toContain("Anonymous Reviewer");
  expect(markup).toContain("Review Text: CC BY 4.0");
  expect(markup).toContain("Permalink");
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
  expect(markup).toContain("<strong>labs</strong>");
});

test("Review composer warns that metadata is preserved and files are not scanned", async () => {
  const { ReviewComposer } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(
    <ReviewComposer
      courses={[{ coursePrefix: "COMP", courseNumber: "2000" }]}
      initialCourse={{ coursePrefix: "COMP", courseNumber: "2000" }}
      instructors={[
        { instructorUuid: review.instructorUuid, name: "Ada Instructor" },
      ]}
    />,
  );
  expect(markup).toContain("Embedded metadata is preserved");
  expect(markup).toContain(
    "does not resize, strip, transcode, or malware-scan",
  );
  expect(markup).toContain("32 MiB");
  expect(markup).toContain("at most four Attachments");
  expect(markup).toContain("publish while an upload is pending");
  expect(markup).toContain("PDF, TXT, Markdown, CSV");
  expect(markup).toContain("not antivirus assurance");
  expect(markup).toContain("not licensed under CC BY 4.0");
  expect(markup).not.toMatch(/malware-scanned files are safe/i);
});

test("public Reviews render authorized Image Attachments inline and in the file list", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const attachment = {
    id: "00000000-0000-4000-8000-000000000348",
    storedFileId: "00000000-0000-4000-8000-000000000248",
    filename: "lab.jpg",
    description: "Lab bench",
    mime: "image/jpeg",
    kind: "image" as const,
    available: true,
  };
  const markup = renderToStaticMarkup(
    <Reviews
      reviews={[
        {
          ...review,
          markdown: `See ![ignored](/attachments/${attachment.id}) and ![nope](https://evil.example/x.png)`,
          attachments: [attachment],
        },
      ]}
    />,
  );
  expect(markup).toContain(`src="/attachments/${attachment.id}"`);
  expect(markup).toContain('alt="Lab bench"');
  expect(markup).toContain(">lab.jpg</a>");
  expect(markup).toContain("Lab bench");
  expect(markup).not.toContain("evil.example");
  expect(markup).not.toContain("ignored");
});

test("Document Attachments are listed with unscanned warnings and are never embedded", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const attachment = {
    id: "00000000-0000-4000-8000-000000000349",
    storedFileId: "00000000-0000-4000-8000-000000000249",
    filename: "notes.pdf",
    description: "Course notes",
    mime: "application/pdf",
    kind: "document" as const,
    available: true,
  };
  const markup = renderToStaticMarkup(
    <Reviews
      reviews={[
        {
          ...review,
          markdown: `See ![nope](/attachments/${attachment.id})`,
          attachments: [attachment],
        },
      ]}
    />,
  );
  expect(markup).toContain(`href="/attachments/${attachment.id}"`);
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain(`href="/attachments/${attachment.id}?download=1"`);
  expect(markup).toContain("has not been malware-scanned");
  expect(markup).not.toContain(`src="/attachments/${attachment.id}"`);
  expect(markup).not.toContain("nope");
});

test("removed Stored Files render an Attachment Tombstone placeholder", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const attachment = {
    id: "00000000-0000-4000-8000-000000000350",
    storedFileId: "00000000-0000-4000-8000-000000000250",
    filename: "gone.jpg",
    description: "Former photo",
    mime: "image/jpeg",
    kind: "image" as const,
    available: false,
  };
  const markup = renderToStaticMarkup(
    <Reviews reviews={[{ ...review, attachments: [attachment] }]} />,
  );
  expect(markup).toContain("This Attachment is no longer available");
  expect(markup).not.toContain(`href="/attachments/${attachment.id}"`);
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
  expect(markup).toContain(
    "Historical Instructor association retained after an identity merge.",
  );
  expect(markup).toContain("Edit Review");
  expect(markup).toContain("Withdraw Review");
});

test("public Reviews expose private reporting without a moderation log", async () => {
  const { Reviews } = await import("@/app/courses/course-reviews");
  const markup = renderToStaticMarkup(<Reviews reviews={[review]} />);
  expect(markup).toContain("Report this Review");
  expect(markup).toContain("Report Review");
  expect(markup).toContain('name="reasonCategory"');
  expect(markup).toContain('value="harassment"');
  expect(markup).toContain("Reporter identity stays private");
  expect(markup).toContain("no public moderation log");
  expect(markup).not.toContain("reporterUserId");
  expect(markup).not.toContain("Moderator");
  expect(markup).not.toContain("Administrator");
});
