"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { authorizedInlineImage } from "@/lib/attachments/attachments";
import {
  REPORT_REASON_CATEGORIES,
  REPORT_REASON_LABELS,
} from "@/lib/contributions/moderation";
import type { PublicReview } from "@/lib/contributions/reviews";
import { rankingTermName } from "@/lib/rankings/presentation";
import { coursePath, instructorPath } from "@/lib/routes";
import { reportReview } from "./review-actions";

const publishedAt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function SafeMarkdown({
  markdown,
  attachments = [],
}: {
  markdown: string;
  attachments?: Array<{ id: string; description: string }>;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
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
              className="h-auto max-w-full rounded-lg border border-gray-200"
              loading="lazy"
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

export function associationFields(review: PublicReview) {
  return (
    <>
      {review.course ? (
        <input
          name="course"
          type="hidden"
          value={`${review.course.coursePrefix}|${review.course.courseNumber}`}
        />
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

function reviewCreditName(review: PublicReview) {
  return review.attribution === "identity-hidden"
    ? "Anonymous Reviewer"
    : (review.capturedDisplayName ?? review.attributionCredit);
}

function ReviewCardHeader({
  review,
  instructorName,
  displayTermNames,
}: {
  review: PublicReview;
  instructorName?: string;
  displayTermNames: boolean;
}) {
  const identityHidden = review.attribution === "identity-hidden";
  const author = reviewCreditName(review);
  const details = [
    review.instructorUuid
      ? {
          label: instructorName ?? review.instructorUuid,
          href: instructorPath(review.instructorUuid),
        }
      : undefined,
    review.course
      ? {
          label: `${review.course.coursePrefix} ${review.course.courseNumber}`,
          href: coursePath(
            review.course.coursePrefix,
            review.course.courseNumber,
          ),
        }
      : undefined,
    review.termCode
      ? {
          label: displayTermNames
            ? rankingTermName(review.termCode)
            : review.termCode,
          href: review.course
            ? coursePath(
                review.course.coursePrefix,
                review.course.courseNumber,
                review.termCode,
              )
            : undefined,
        }
      : undefined,
    review.section
      ? {
          label: review.section,
          href:
            review.course && review.termCode
              ? coursePath(
                  review.course.coursePrefix,
                  review.course.courseNumber,
                  review.termCode,
                  review.section,
                )
              : undefined,
        }
      : undefined,
  ].filter((detail): detail is { label: string; href: string | undefined } =>
    Boolean(detail),
  );
  return (
    <header className="flex flex-col gap-1.5">
      <p
        className={`text-pretty text-base !font-semibold leading-snug ${identityHidden ? "text-gray-500" : "text-gray-950"}`}
      >
        {author}
      </p>
      <p className="flex flex-wrap gap-x-1.5 text-sm text-gray-500 tabular-nums">
        <time dateTime={review.publishedAt.toISOString()}>
          {publishedAt.format(review.publishedAt)}
        </time>
        {details.map((detail) => (
          <span key={`${detail.label}-${detail.href}`}>
            ·{" "}
            {detail.href ? (
              <Link
                href={detail.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {detail.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            ) : (
              detail.label
            )}
          </span>
        ))}
      </p>
    </header>
  );
}

function ReviewPermalinkCopy({ review }: { review: PublicReview }) {
  async function copyCredit() {
    try {
      const permalink = new URL(`/reviews/${review.id}`, window.location.origin)
        .href;
      await navigator.clipboard.writeText(
        `${reviewCreditName(review)} — ${permalink}`,
      );
      toast.success("Permalink copied.");
    } catch {
      toast.error("Permalink could not be copied.");
    }
  }

  return (
    <Button
      className="h-auto cursor-pointer p-0 text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900"
      onClick={copyCredit}
      type="button"
      variant="link"
    >
      Copy Permalink
    </Button>
  );
}

function ReviewCardReport({ review }: { review: PublicReview }) {
  const reasonId = `report-reason-${review.id}`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          className="h-auto cursor-pointer p-0 text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900"
          type="button"
          variant="link"
        >
          Report
        </Button>
      </DialogTrigger>
      <DialogContent className="overscroll-contain">
        <form action={reportReview} className="flex flex-col gap-5">
          <input name="reviewId" type="hidden" value={review.id} />
          {associationFields(review)}
          <DialogHeader>
            <DialogTitle>Report this Review</DialogTitle>
            <DialogDescription>
              Tell the moderation team what needs attention. The author will not
              see who submitted the report.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={reasonId}>Reason</FieldLabel>
              <select
                autoComplete="off"
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-950"
                defaultValue=""
                id={reasonId}
                name="reasonCategory"
                required
              >
                <option disabled value="">
                  Select a reason…
                </option>
                {REPORT_REASON_CATEGORIES.map((reason) => (
                  <option key={reason} value={reason}>
                    {REPORT_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
              <FieldDescription>
                Reporter identity stays private. There is no public moderation
                log.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button className="cursor-pointer" type="submit">
              Submit Report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewCard({
  review,
  instructorName,
  displayTermNames = false,
  children,
}: {
  review: PublicReview;
  instructorName?: string;
  displayTermNames?: boolean;
  children?: ReactNode;
}) {
  return (
    <article
      className="scroll-mt-24 !gap-0 text-left"
      id={`review-${review.id}`}
    >
      <ReviewCardHeader
        displayTermNames={displayTermNames}
        instructorName={instructorName}
        review={review}
      />
      <div className="mt-4 min-w-0">
        <div className="flex flex-col gap-4">
          {review.instructorAssociationStatus === "needs-resolution" ? (
            <Alert>
              <AlertDescription className="mt-0">
                Instructor association needs resolution after an identity
                correction; it has not been guessed or reassigned.
              </AlertDescription>
            </Alert>
          ) : review.instructorAssociationStatus === "historical" ? (
            <p className="text-sm text-gray-500">
              Historical Instructor association retained after an identity
              merge.
            </p>
          ) : null}
          <div className="prose prose-sm prose-slate max-w-none min-w-0 break-words">
            <SafeMarkdown
              attachments={review.attachments}
              markdown={review.markdown}
            />
          </div>
          {review.attachments?.length ? (
            <ul className="!m-0 flex !list-none flex-col gap-2 text-sm">
              {review.attachments.map((attachment) => (
                <li key={attachment.id}>
                  {attachment.available === false ? (
                    <p>
                      This Attachment is no longer available —{" "}
                      {attachment.filename} — {attachment.description}
                    </p>
                  ) : attachment.kind === "document" ? (
                    <>
                      <a
                        href={`/attachments/${attachment.id}`}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Open {attachment.filename}
                      </a>
                      {" · "}
                      <a href={`/attachments/${attachment.id}?download=1`}>
                        Download
                      </a>
                      {" — "}
                      {attachment.description}
                      <p className="text-xs text-amber-950">
                        This file has not been malware-scanned. Open it only if
                        you trust the author. Strict format validation is not
                        antivirus assurance.
                      </p>
                    </>
                  ) : (
                    <>
                      <a href={`/attachments/${attachment.id}`}>
                        {attachment.filename}
                      </a>
                      {" — "}
                      {attachment.description}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <footer className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-xs text-gray-500">
              Review Text: {review.license ?? "CC BY 4.0"}
            </p>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
              <ReviewPermalinkCopy review={review} />
              <Button
                asChild
                className="h-auto p-0 text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900"
                variant="link"
              >
                <a
                  href={`/reviews/${review.id}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Permalink
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
              {children}
              {review.viewerCanEdit ? null : (
                <ReviewCardReport review={review} />
              )}
            </div>
          </div>
        </footer>
      </div>
    </article>
  );
}
