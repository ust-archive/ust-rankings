"use client";

import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { PublicCourseReview } from "@/lib/contributions/reviews";
import { publishCourseReview } from "./review-actions";

export function CourseReviewComposer({
  coursePrefix,
  courseNumber,
}: {
  coursePrefix: string;
  courseNumber: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        className="mt-4 min-h-11 w-full rounded-xl bg-[#003366] px-4 py-3 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        Write a Course Review
      </button>
      <dialog
        aria-labelledby="course-review-composer-title"
        className="m-auto w-[min(42rem,calc(100%-2rem))] rounded-2xl p-0 text-left shadow-2xl backdrop:bg-slate-950/60"
        ref={dialog}
      >
        <form action={publishCourseReview} className="space-y-5 p-6 sm:p-8">
          <header>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
              Your Course experience
            </p>
            <h2
              className="mt-1 text-2xl font-black"
              id="course-review-composer-title"
            >
              Write your Review
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Course Basis · {coursePrefix} {courseNumber}
            </p>
          </header>
          <input name="coursePrefix" type="hidden" value={coursePrefix} />
          <input name="courseNumber" type="hidden" value={courseNumber} />
          <div>
            <label className="font-bold" htmlFor="course-review-markdown">
              Review · Markdown
            </label>
            <textarea
              aria-describedby="course-review-markdown-help"
              className="mt-2 min-h-40 w-full rounded-xl border border-slate-300 p-3"
              id="course-review-markdown"
              name="markdown"
              required
            />
            <p
              className="mt-2 text-xs text-slate-600"
              id="course-review-markdown-help"
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
              className="min-h-11 rounded-xl bg-[#003366] px-5 py-3 font-bold text-white"
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

export function CourseReviews({ reviews }: { reviews: PublicCourseReview[] }) {
  if (reviews.length === 0)
    return (
      <p className="mt-2 text-slate-600">
        No Course Reviews have been published yet.
      </p>
    );
  return (
    <ol className="mt-5 space-y-5">
      {reviews.map((review) => (
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
          <div className="prose prose-slate mt-4 max-w-none leading-7">
            <ReactMarkdown components={{ img: () => null }} skipHtml>
              {review.markdown}
            </ReactMarkdown>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Attributed Review Revision · Review text licensed CC BY 4.0
          </p>
        </li>
      ))}
    </ol>
  );
}
