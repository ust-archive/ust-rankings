"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { authorizedInlineImage } from "@/lib/attachments/attachments";
import type {
  PublicReview,
  ReviewAssociations,
  ReviewAttribution,
} from "@/lib/contributions/reviews";
import { editReview, publishReview, withdrawReview } from "./review-actions";

export type ReviewCourseOption = {
  coursePrefix: string;
  courseNumber: string;
  label?: string;
};
export type ReviewInstructorOption = { instructorUuid: string; name: string };
export type ReviewContextOption = ReviewAssociations & { termName?: string };
export type ReviewEditorOptions = {
  courses: ReviewCourseOption[];
  instructors: ReviewInstructorOption[];
  contexts?: ReviewContextOption[];
};

function courseValue(course: ReviewCourseOption) {
  return `${course.coursePrefix}|${course.courseNumber}`;
}

type DraftAttachment = {
  id: string;
  storedFileId: string;
  filename: string;
  description: string;
  status: "ready" | "pending" | "failed";
};

function SafeMarkdown({
  markdown,
  attachments = [],
}: {
  markdown: string;
  attachments?: Array<{ id: string; description: string }>;
}) {
  return (
    <ReactMarkdown
      components={{
        img: ({ src }) => {
          const attachment = authorizedInlineImage(
            typeof src === "string" ? src : undefined,
            attachments,
          );
          if (!attachment) return null;
          return (
            // Exact Attachment bytes must not pass through next/image.
            // biome-ignore lint/performance/noImgElement: preserve unmodified raster bytes
            <img
              alt={attachment.description}
              src={`/attachments/${attachment.id}`}
            />
          );
        },
      }}
      skipHtml
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function ReviewComposer({
  courses,
  instructors,
  contexts = [],
  initialCourse,
  initialInstructorUuid,
  review,
}: ReviewEditorOptions & {
  initialCourse?: ReviewCourseOption;
  initialInstructorUuid?: string;
  review?: PublicReview;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const edit = Boolean(review);
  const selectedInitialCourse = review?.course ?? initialCourse;
  const selectedInitialInstructor =
    review?.instructorUuid ?? initialInstructorUuid;
  const [courseEnabled, setCourseEnabled] = useState(
    Boolean(selectedInitialCourse),
  );
  const [instructorEnabled, setInstructorEnabled] = useState(
    Boolean(selectedInitialInstructor),
  );
  const [course, setCourse] = useState(
    selectedInitialCourse
      ? courseValue(selectedInitialCourse)
      : courseValue(courses[0] ?? { coursePrefix: "", courseNumber: "" }),
  );
  const [instructorUuid, setInstructorUuid] = useState(
    selectedInitialInstructor ?? instructors[0]?.instructorUuid ?? "",
  );
  const [termCode, setTermCode] = useState(review?.termCode ?? "");
  const [section, setSection] = useState(review?.section ?? "");
  const [attachments, setAttachments] = useState<DraftAttachment[]>(() =>
    (review?.attachments ?? []).map((attachment) => ({
      id: crypto.randomUUID(),
      storedFileId: attachment.storedFileId,
      filename: attachment.filename,
      description: attachment.description,
      status: "ready" as const,
    })),
  );
  const [markdown, setMarkdown] = useState(() => {
    let value = review?.markdown ?? "";
    for (const [index, attachment] of (review?.attachments ?? []).entries()) {
      const draft = attachments[index];
      if (draft)
        value = value.replaceAll(
          `/attachments/${attachment.id}`,
          `/attachments/${draft.id}`,
        );
    }
    return value;
  });
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [attribution, setAttribution] = useState<ReviewAttribution>(
    review?.attribution ?? "attributed",
  );
  const [selectedCoursePrefix, selectedCourseNumber] = courseEnabled
    ? course.split("|")
    : [];
  const validContexts = useMemo(
    () =>
      contexts.filter(
        (context) =>
          (courseEnabled
            ? context.course?.coursePrefix === selectedCoursePrefix &&
              context.course.courseNumber === selectedCourseNumber
            : context.course === undefined) &&
          (instructorEnabled
            ? context.instructorUuid === instructorUuid
            : context.instructorUuid === undefined),
      ),
    [
      contexts,
      courseEnabled,
      selectedCoursePrefix,
      selectedCourseNumber,
      instructorEnabled,
      instructorUuid,
    ],
  );
  const terms = useMemo(
    () => [
      ...new Map(
        validContexts.flatMap((item) =>
          item.termCode
            ? [[item.termCode, item.termName ?? item.termCode] as const]
            : [],
        ),
      ).entries(),
    ],
    [validContexts],
  );
  const sections = useMemo(
    () =>
      validContexts
        .flatMap((item) =>
          item.termCode === termCode && item.section ? [item.section] : [],
        )
        .filter((value, index, values) => values.indexOf(value) === index),
    [validContexts, termCode],
  );
  const courseSupported =
    !courseEnabled ||
    courses.some(
      (item) =>
        item.coursePrefix === selectedCoursePrefix &&
        item.courseNumber === selectedCourseNumber,
    );
  const instructorSupported =
    !instructorEnabled ||
    instructors.some((item) => item.instructorUuid === instructorUuid);
  const contextSupported =
    !termCode ||
    validContexts.some(
      (item) =>
        item.termCode === termCode &&
        (section === "" || item.section === section),
    );
  const selectionSupported =
    courseSupported && instructorSupported && contextSupported;
  const displayedCourses =
    selectedInitialCourse &&
    !courses.some(
      (item) => courseValue(item) === courseValue(selectedInitialCourse),
    )
      ? [
          {
            ...selectedInitialCourse,
            label: `${selectedInitialCourse.coursePrefix} ${selectedInitialCourse.courseNumber} (current snapshot)`,
          },
          ...courses,
        ]
      : courses;
  const displayedInstructors =
    selectedInitialInstructor &&
    !instructors.some(
      (item) => item.instructorUuid === selectedInitialInstructor,
    )
      ? [
          {
            instructorUuid: selectedInitialInstructor,
            name: `${selectedInitialInstructor} (current snapshot)`,
          },
          ...instructors,
        ]
      : instructors;
  const displayedTerms =
    review?.termCode && !terms.some(([value]) => value === review.termCode)
      ? [
          [review.termCode, `${review.termCode} (current snapshot)`] as const,
          ...terms,
        ]
      : terms;
  const displayedSections =
    review?.section && !sections.includes(review.section)
      ? [review.section, ...sections]
      : sections;

  useEffect(() => {
    if (review) return;
    if (termCode && !terms.some(([value]) => value === termCode)) {
      setTermCode("");
      setSection("");
    } else if (section && !sections.includes(section)) setSection("");
  }, [review, termCode, section, terms, sections]);

  const hasBasis = courseEnabled || instructorEnabled;
  const readyAttachments = attachments.filter(
    (attachment) => attachment.status === "ready" && attachment.storedFileId,
  );
  async function addImageFiles(fileList: FileList | null) {
    if (!fileList) return;
    const room = 4 - attachments.length;
    for (const file of [...fileList].slice(0, room)) {
      const id = crypto.randomUUID();
      setAttachments((current) => [
        ...current,
        {
          id,
          storedFileId: "",
          filename: file.name,
          description: file.name.replace(/\.[^.]+$/u, "") || file.name,
          status: "pending",
        },
      ]);
      try {
        const reserved = await fetch("/api/attachments/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            byteSize: file.size,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
          }),
        });
        if (!reserved.ok) throw new Error("reserve");
        const body = (await reserved.json()) as {
          intentId: string;
          uploadUrl: string;
          uploadHeaders: Record<string, string>;
        };
        const uploaded = await fetch(body.uploadUrl, {
          method: "PUT",
          headers: body.uploadHeaders,
          body: file,
        });
        if (!uploaded.ok) throw new Error("put");
        const completed = await fetch(
          `/api/attachments/uploads/${body.intentId}/complete`,
          { method: "POST" },
        );
        if (!completed.ok) throw new Error("complete");
        const stored = (await completed.json()) as { id: string };
        setAttachments((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, storedFileId: stored.id, status: "ready" }
              : item,
          ),
        );
      } catch {
        setAttachments((current) =>
          current.map((item) =>
            item.id === id ? { ...item, status: "failed" } : item,
          ),
        );
      }
    }
  }
  const inputId = review ? `review-markdown-${review.id}` : "review-markdown";
  const titleId = review
    ? `review-composer-title-${review.id}`
    : "review-composer-title";
  return (
    <>
      <button
        className="mt-4 min-h-11 w-full rounded-xl bg-[#003366] px-4 py-3 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        {edit ? "Edit Review" : "Write a Review"}
      </button>
      <dialog
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100%-2rem)] w-[min(42rem,calc(100%-2rem))] overflow-y-auto rounded-2xl p-0 text-left shadow-2xl backdrop:bg-slate-950/60"
        ref={dialog}
      >
        <form
          action={edit ? editReview : publishReview}
          className="space-y-5 p-6 sm:p-8"
        >
          {review ? (
            <>
              <input name="reviewId" type="hidden" value={review.id} />
              <input
                name="expectedRevisionId"
                type="hidden"
                value={review.revisionId}
              />
            </>
          ) : null}
          <header>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
              Your experience
            </p>
            <h2 className="mt-1 text-2xl font-black" id={titleId}>
              {edit ? "Edit your Review" : "Write your Review"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Choose one or two co-equal Review Bases, then optional Review
              Context.
            </p>
          </header>
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 font-bold">Review Bases</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input
                aria-label="Include Course Basis"
                checked={courseEnabled}
                disabled={!courses.length && !courseEnabled}
                onChange={(event) => setCourseEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="w-24 font-semibold">Course</span>
              <select
                aria-label="Course Basis"
                className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3"
                disabled={!courseEnabled}
                name="course"
                onChange={(event) => setCourse(event.target.value)}
                value={course}
              >
                {displayedCourses.map((item) => (
                  <option key={courseValue(item)} value={courseValue(item)}>
                    {item.label ?? `${item.coursePrefix} ${item.courseNumber}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input
                aria-label="Include Instructor Basis"
                checked={instructorEnabled}
                disabled={!instructors.length && !instructorEnabled}
                onChange={(event) => setInstructorEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="w-24 font-semibold">Instructor</span>
              <select
                aria-label="Instructor Basis"
                className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3"
                disabled={!instructorEnabled}
                name="instructorUuid"
                onChange={(event) => setInstructorUuid(event.target.value)}
                value={instructorUuid}
              >
                {displayedInstructors.map((item) => (
                  <option key={item.instructorUuid} value={item.instructorUuid}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {!hasBasis ? (
              <p className="text-sm text-red-700" role="alert">
                Select at least one Review Basis.
              </p>
            ) : null}
          </fieldset>
          <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
            <legend className="px-1 font-bold">
              Review Context{" "}
              <span className="font-normal text-slate-500">(optional)</span>
            </legend>
            <label className="font-semibold">
              Term
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                name="termCode"
                onChange={(event) => {
                  setTermCode(event.target.value);
                  setSection("");
                }}
                value={termCode}
              >
                <option value="">General</option>
                {displayedTerms.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-semibold">
              Section
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                disabled={!courseEnabled || !termCode}
                name="section"
                onChange={(event) => setSection(event.target.value)}
                value={section}
              >
                <option value="">All Sections</option>
                {displayedSections.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-600 sm:col-span-2">
              Term qualifies every selected Review Basis. Section requires a
              Course Basis and Term and identifies a Class.
            </p>
            {edit && !selectionSupported ? (
              <p
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:col-span-2"
                role="alert"
              >
                This Review snapshot is no longer source-backed. Select
                supported Review Bases and Review Context before publishing.
                Persisted values are shown as the current snapshot and will not
                be removed automatically.
              </p>
            ) : null}
          </fieldset>
          <div>
            <div className="flex items-end justify-between gap-3">
              <label className="font-bold" htmlFor={inputId}>
                Review · Markdown
              </label>
              <fieldset className="flex">
                <legend className="sr-only">Markdown mode</legend>
                {(["write", "preview"] as const).map((value) => (
                  <button
                    aria-pressed={mode === value}
                    className="min-h-11 rounded-lg px-3 text-sm font-semibold capitalize aria-pressed:bg-blue-100"
                    key={value}
                    onClick={() => setMode(value)}
                    type="button"
                  >
                    {value === "write" ? "Write" : "Preview"}
                  </button>
                ))}
              </fieldset>
            </div>
            <textarea
              aria-describedby={`${inputId}-help`}
              className={`mt-2 min-h-40 w-full rounded-xl border border-slate-300 p-3 ${mode === "preview" ? "sr-only" : ""}`}
              id={inputId}
              name="markdown"
              onChange={(event) => setMarkdown(event.target.value)}
              required
              value={markdown}
            />
            {mode === "preview" ? (
              <div
                aria-live="polite"
                className="prose prose-slate mt-2 min-h-40 max-w-none rounded-xl border border-slate-300 p-3"
              >
                {markdown ? (
                  <SafeMarkdown
                    attachments={readyAttachments}
                    markdown={markdown}
                  />
                ) : (
                  <p className="text-slate-500">Nothing to preview.</p>
                )}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-slate-600" id={`${inputId}-help`}>
              Raw HTML is not rendered. Remote images are prohibited. Inline
              images may reference only an Image Attachment on this Revision as
              <code>{`/attachments/{id}`}</code>; the Attachment description is
              used as alt text.
            </p>
          </div>
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 font-bold">Image Attachments</legend>
            <input
              name="attachments"
              type="hidden"
              value={JSON.stringify(
                readyAttachments.map(
                  ({ id, storedFileId, filename, description }) => ({
                    id,
                    storedFileId,
                    filename,
                    description,
                  }),
                ),
              )}
            />
            <p className="text-sm text-amber-950">
              Embedded metadata is preserved and may expose names, device
              information, or location. UST Rankings does not resize, strip,
              transcode, or malware-scan files. Accepted JPEG, PNG, GIF, WebP,
              and HEIC/HEIF images count toward a 32 MiB distinct Stored File
              quota, including pending uploads. A Revision has at most four
              Attachments. Review text can publish while an upload is pending.
            </p>
            <input
              accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif"
              disabled={attachments.length >= 4}
              onChange={(event) => {
                void addImageFiles(event.target.files);
                event.target.value = "";
              }}
              type="file"
            />
            {attachments.map((attachment) => (
              <div className="grid gap-2 sm:grid-cols-2" key={attachment.id}>
                <p className="text-sm">
                  {attachment.filename} · {attachment.status}
                </p>
                <label className="text-sm font-semibold">
                  Description
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                    onChange={(event) =>
                      setAttachments((current) =>
                        current.map((item) =>
                          item.id === attachment.id
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={attachment.description}
                  />
                </label>
                {attachment.status === "ready" ? (
                  <button
                    className="justify-self-start text-sm font-semibold text-blue-800"
                    onClick={() =>
                      setMarkdown(
                        `${markdown}${markdown.endsWith("\n") || !markdown ? "" : "\n"}![](/attachments/${attachment.id})\n`,
                      )
                    }
                    type="button"
                  >
                    Insert inline
                  </button>
                ) : null}
              </div>
            ))}
            <p className="text-xs text-slate-600">
              Attachments are not licensed under CC BY 4.0. You warrant you have
              the right to upload them and grant UST Rankings a non-exclusive
              license to store, deliver, display, and moderate them.
            </p>
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 font-bold">Public identity</legend>
            <label className="flex items-start gap-3">
              <input
                checked={attribution === "attributed"}
                name="attribution"
                onChange={() => setAttribution("attributed")}
                type="radio"
                value="attributed"
              />
              <span>
                <strong>Attributed</strong> — capture and display your current
                Public Display Name for this Revision.
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                checked={attribution === "identity-hidden"}
                name="attribution"
                onChange={() => setAttribution("identity-hidden")}
                type="radio"
                value="identity-hidden"
              />
              <span>
                <strong>Identity hidden</strong> — display no author name.
              </span>
            </label>
            <p className="text-sm text-slate-700">
              Identity hidden is not anonymous to UST Rankings. An authorized
              operator can link this Review to your account for moderation,
              security, rights, and legal purposes.
            </p>
          </fieldset>
          <div className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            {edit
              ? "Publishing this edit creates a new immutable Review Revision. Earlier Revisions remain internal."
              : "Publishing creates an immutable Review Revision."}{" "}
            Attribution is selected independently for each Revision.
          </div>
          <div className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Review text is published under CC BY 4.0. Attributed credit uses
            your captured Public Display Name plus the Review permalink;
            Identity-hidden credit uses “UST Rankings contributor” plus the
            permalink. You also grant UST Rankings a non-exclusive site license
            to host, format, display, and moderate it. CC BY 4.0 rights already
            granted to obtained copies cannot be recalled, even after
            withdrawal.
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-5">
            <button
              className="min-h-11 px-3 font-semibold text-slate-600"
              onClick={() => dialog.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <button
              className="min-h-11 rounded-xl bg-[#003366] px-5 py-3 font-bold text-white disabled:bg-slate-400"
              disabled={!hasBasis || (edit && !selectionSupported)}
              type="submit"
            >
              Publish Revision
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function associationFields(review: PublicReview) {
  return (
    <>
      {review.course ? (
        <input name="course" type="hidden" value={courseValue(review.course)} />
      ) : null}
      {review.instructorUuid ? (
        <input
          name="instructorUuid"
          type="hidden"
          value={review.instructorUuid}
        />
      ) : null}
    </>
  );
}

export function Reviews({
  reviews,
  editor,
}: {
  reviews: PublicReview[];
  editor?: ReviewEditorOptions;
}) {
  if (reviews.length === 0)
    return (
      <p className="mt-2 text-slate-600">No Reviews have been published yet.</p>
    );
  return (
    <ol className="mt-5 space-y-5">
      {reviews.map((review) => {
        const permalink = `/reviews/${review.id}`;
        const identityHidden = review.attribution === "identity-hidden";
        const credit = identityHidden
          ? "UST Rankings contributor"
          : (review.capturedDisplayName ?? review.attributionCredit);
        return (
          <li
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            id={`review-${review.id}`}
            key={review.id}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
              <p className="font-bold">{credit}</p>
              <time
                className="text-xs text-slate-500"
                dateTime={review.publishedAt.toISOString()}
              >
                {review.publishedAt.toISOString().slice(0, 10)}
              </time>
            </header>
            <fieldset className="mt-3 flex flex-wrap gap-2">
              <legend className="sr-only">Review Bases</legend>
              {review.course ? (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold">
                  Course Basis · {review.course.coursePrefix}{" "}
                  {review.course.courseNumber}
                </span>
              ) : null}
              {review.instructorUuid ? (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold">
                  Instructor Basis · {review.instructorUuid}
                </span>
              ) : null}
            </fieldset>
            {review.termCode ? (
              <p className="mt-2 text-sm text-slate-600">
                Review Context · Term {review.termCode}
                {review.section ? ` · Section ${review.section}` : ""}
              </p>
            ) : null}
            {review.instructorAssociationStatus === "needs-resolution" ? (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
                Instructor association needs resolution after an identity
                correction; it has not been guessed or reassigned.
              </p>
            ) : review.instructorAssociationStatus === "historical" ? (
              <p className="mt-2 text-sm text-slate-600">
                Historical Instructor association retained after an identity
                merge.
              </p>
            ) : null}
            <div className="prose prose-slate mt-4 max-w-none leading-7">
              <SafeMarkdown
                attachments={review.attachments}
                markdown={review.markdown}
              />
            </div>
            {review.attachments?.length ? (
              <ul className="mt-4 space-y-1 text-sm">
                {review.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a href={`/attachments/${attachment.id}`}>
                      {attachment.filename}
                    </a>
                    {" — "}
                    {attachment.description}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-4 text-xs text-slate-500">
              {identityHidden
                ? "Identity-hidden Review Revision"
                : "Attributed Review Revision"}{" "}
              · Review text licensed {review.license ?? "CC BY 4.0"} ·{" "}
              <a href={permalink}>Review permalink</a>
            </p>
            {review.viewerCanEdit && editor ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <ReviewComposer {...editor} review={review} />
                <form action={withdrawReview} className="mt-3">
                  <input name="reviewId" type="hidden" value={review.id} />
                  <input
                    name="expectedRevisionId"
                    type="hidden"
                    value={review.revisionId}
                  />
                  {associationFields(review)}
                  <p className="text-xs text-slate-600">
                    Withdrawal removes the current Review from public display;
                    justified immutable Revisions remain internal, and obtained
                    CC BY 4.0 copies cannot be recalled.
                  </p>
                  <button
                    className="mt-2 min-h-11 rounded-xl border border-red-300 px-4 py-2 font-bold text-red-800"
                    type="submit"
                  >
                    Withdraw Review
                  </button>
                </form>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
