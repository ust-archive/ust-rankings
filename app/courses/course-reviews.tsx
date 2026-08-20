"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type {
  PublicReview,
  ReviewAssociations,
} from "@/lib/contributions/reviews";
import { publishReview } from "./review-actions";

export type ReviewCourseOption = {
  coursePrefix: string;
  courseNumber: string;
  label?: string;
};
export type ReviewInstructorOption = { instructorUuid: string; name: string };
export type ReviewContextOption = ReviewAssociations & { termName?: string };

function courseValue(course: ReviewCourseOption) {
  return `${course.coursePrefix}|${course.courseNumber}`;
}

export function ReviewComposer({
  courses,
  instructors,
  contexts = [],
  initialCourse,
  initialInstructorUuid,
}: {
  courses: ReviewCourseOption[];
  instructors: ReviewInstructorOption[];
  contexts?: ReviewContextOption[];
  initialCourse?: ReviewCourseOption;
  initialInstructorUuid?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [courseEnabled, setCourseEnabled] = useState(Boolean(initialCourse));
  const [instructorEnabled, setInstructorEnabled] = useState(
    Boolean(initialInstructorUuid),
  );
  const [course, setCourse] = useState(
    initialCourse
      ? courseValue(initialCourse)
      : courseValue(courses[0] ?? { coursePrefix: "", courseNumber: "" }),
  );
  const [instructorUuid, setInstructorUuid] = useState(
    initialInstructorUuid ?? instructors[0]?.instructorUuid ?? "",
  );
  const [termCode, setTermCode] = useState("");
  const [section, setSection] = useState("");
  const [selectedCoursePrefix, selectedCourseNumber] = courseEnabled
    ? course.split("|")
    : [];
  const validContexts = useMemo(
    () =>
      contexts.filter(
        (context) =>
          (!selectedCoursePrefix ||
            (context.course?.coursePrefix === selectedCoursePrefix &&
              context.course.courseNumber === selectedCourseNumber)) &&
          (!instructorEnabled || context.instructorUuid === instructorUuid),
      ),
    [
      contexts,
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

  useEffect(() => {
    if (termCode && !terms.some(([value]) => value === termCode)) {
      setTermCode("");
      setSection("");
    } else if (section && !sections.includes(section)) setSection("");
  }, [termCode, section, terms, sections]);

  const hasBasis = courseEnabled || instructorEnabled;
  return (
    <>
      <button
        className="mt-4 min-h-11 w-full rounded-xl bg-[#003366] px-4 py-3 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        Write a Review
      </button>
      <dialog
        aria-labelledby="review-composer-title"
        className="m-auto max-h-[calc(100%-2rem)] w-[min(42rem,calc(100%-2rem))] overflow-y-auto rounded-2xl p-0 text-left shadow-2xl backdrop:bg-slate-950/60"
        ref={dialog}
      >
        <form action={publishReview} className="space-y-5 p-6 sm:p-8">
          <header>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
              Your experience
            </p>
            <h2 className="mt-1 text-2xl font-black" id="review-composer-title">
              Write your Review
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
                disabled={!courses.length}
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
                {courses.map((item) => (
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
                disabled={!instructors.length}
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
                {instructors.map((item) => (
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
                {terms.map(([value, label]) => (
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
                {sections.map((value) => (
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
          </fieldset>
          <div>
            <label className="font-bold" htmlFor="review-markdown">
              Review · Markdown
            </label>
            <textarea
              aria-describedby="review-markdown-help"
              className="mt-2 min-h-40 w-full rounded-xl border border-slate-300 p-3"
              id="review-markdown"
              name="markdown"
              required
            />
            <p
              className="mt-2 text-xs text-slate-600"
              id="review-markdown-help"
            >
              Text only. Raw HTML and remote images are not displayed.
            </p>
          </div>
          <div className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            Publishing creates an Attributed Review Revision. Your current
            Public Display Name is captured for this Revision; later account
            changes do not rewrite it.
          </div>
          <div className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Review text is published under CC BY 4.0 with your captured name and
            Review permalink as attribution. You also grant UST Rankings a
            non-exclusive site license to host, format, display, and moderate
            it. CC BY 4.0 rights already granted to copies cannot be recalled.
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
              disabled={!hasBasis}
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

export function Reviews({ reviews }: { reviews: PublicReview[] }) {
  if (reviews.length === 0)
    return (
      <p className="mt-2 text-slate-600">No Reviews have been published yet.</p>
    );
  return (
    <ol className="mt-5 space-y-5">
      {reviews.map((review) => {
        const permalink = review.course
          ? `/courses/${review.course.coursePrefix}/${review.course.courseNumber}#review-${review.id}`
          : `/instructors/${review.instructorUuid}#review-${review.id}`;
        return (
          <li
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            id={`review-${review.id}`}
            key={review.id}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
              <p className="font-bold">{review.capturedDisplayName}</p>
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
            ) : null}
            <div className="prose prose-slate mt-4 max-w-none leading-7">
              <ReactMarkdown components={{ img: () => null }} skipHtml>
                {review.markdown}
              </ReactMarkdown>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Attributed Review Revision · Review text licensed CC BY 4.0 ·{" "}
              <a href={permalink}>Review permalink</a>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
