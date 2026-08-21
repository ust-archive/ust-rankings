"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  authorizedInlineImage,
  contentTypeForFilename,
} from "@/lib/attachments/attachments";
import {
  REPORT_REASON_CATEGORIES,
  REPORT_REASON_LABELS,
} from "@/lib/contributions/moderation";
import type {
  PublicReview,
  ReviewAssociations,
  ReviewAttribution,
} from "@/lib/contributions/reviews";
import { rankingTermName } from "@/lib/rankings/presentation";
import {
  editReview,
  publishReview,
  reportReview,
  withdrawReview,
} from "./review-actions";

const ReviewMarkdownEditor = dynamic(
  () =>
    import("./review-markdown-editor").then(
      (module) => module.ReviewMarkdownEditor,
    ),
  {
    loading: () => (
      <div className="min-h-48 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        Loading editor…
      </div>
    ),
    ssr: false,
  },
);

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
  kind?: "image" | "document";
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
  initialTermCode,
  initialSection,
  review,
  displayTermNames = false,
}: ReviewEditorOptions & {
  initialCourse?: ReviewCourseOption;
  initialInstructorUuid?: string;
  initialTermCode?: string;
  initialSection?: string;
  review?: PublicReview;
  displayTermNames?: boolean;
}) {
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
  const [termCode, setTermCode] = useState(
    review?.termCode ?? initialTermCode ?? "",
  );
  const [section, setSection] = useState(
    review?.section ?? initialSection ?? "",
  );
  const [attachments, setAttachments] = useState<DraftAttachment[]>(() =>
    (review?.attachments ?? []).map((attachment) => ({
      id: crypto.randomUUID(),
      storedFileId: attachment.storedFileId,
      filename: attachment.filename,
      description: attachment.description,
      status: "ready" as const,
      kind: attachment.kind,
    })),
  );
  const attachmentsRef = useRef(attachments);
  const updateAttachments = (
    update: (current: DraftAttachment[]) => DraftAttachment[],
  ) => {
    const next = update(attachmentsRef.current);
    attachmentsRef.current = next;
    setAttachments(next);
  };
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
            ? [
                [
                  item.termCode,
                  item.termName ??
                    (displayTermNames
                      ? rankingTermName(item.termCode)
                      : item.termCode),
                ] as const,
              ]
            : [],
        ),
      ).entries(),
    ],
    [displayTermNames, validContexts],
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
          [
            review.termCode,
            `${displayTermNames ? rankingTermName(review.termCode) : review.termCode} (current snapshot)`,
          ] as const,
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
  async function uploadFile(file: File) {
    if (attachmentsRef.current.length >= 4)
      throw new Error("A Revision has at most four Attachments.");
    const id = crypto.randomUUID();
    const pending: DraftAttachment = {
      id,
      storedFileId: "",
      filename: file.name,
      description: file.name.replace(/\.[^.]+$/u, "") || file.name,
      status: "pending",
    };
    updateAttachments((current) => [...current, pending]);
    try {
      const reserved = await fetch("/api/attachments/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          byteSize: file.size,
          filename: file.name,
          contentType:
            file.type ||
            contentTypeForFilename(file.name) ||
            "application/octet-stream",
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
      const stored = (await completed.json()) as {
        id: string;
        kind?: "image" | "document";
      };
      const ready: DraftAttachment = {
        ...pending,
        storedFileId: stored.id,
        status: "ready",
        kind: stored.kind,
      };
      updateAttachments((current) =>
        current.map((item) => (item.id === id ? ready : item)),
      );
      return ready;
    } catch (error) {
      updateAttachments((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "failed" } : item,
        ),
      );
      throw error;
    }
  }
  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    for (const file of [...fileList]) {
      try {
        await uploadFile(file);
      } catch {
        break;
      }
    }
  }
  async function uploadImage(file: File) {
    const attachment = await uploadFile(file);
    if (attachment.kind === "document")
      throw new Error("Only Image Attachments can be embedded.");
    return `/attachments/${attachment.id}`;
  }
  const inputId = review ? `review-markdown-${review.id}` : "review-markdown";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">
          {edit ? "Edit Review" : "Create a Review"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-x-hidden overflow-y-auto p-0 text-left">
        <form
          action={edit ? editReview : publishReview}
          className="flex min-w-0 flex-col gap-5 p-6 sm:p-8"
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
          <DialogHeader>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
              Your experience
            </p>
            <DialogTitle className="text-2xl">
              {edit ? "Edit Review" : "Create a Review"}
            </DialogTitle>
            <DialogDescription>
              Choose one or two co-equal Review Bases, then optional Review
              Context.
            </DialogDescription>
          </DialogHeader>
          <FieldSet className="min-w-0 gap-4 rounded-xl border border-gray-200 p-4">
            <FieldLegend>Review Bases</FieldLegend>
            <FieldGroup className="gap-4">
              <Field orientation="horizontal">
                <Checkbox
                  aria-label="Include Course Basis"
                  checked={courseEnabled}
                  disabled={!courses.length && !courseEnabled}
                  id={`${inputId}-course-enabled`}
                  onCheckedChange={(checked) =>
                    setCourseEnabled(checked === true)
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${inputId}-course-enabled`}>
                    Course
                  </FieldLabel>
                  <Select
                    disabled={!courseEnabled}
                    name="course"
                    onValueChange={setCourse}
                    value={course}
                  >
                    <SelectTrigger aria-label="Course Basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {displayedCourses.map((item) => (
                          <SelectItem
                            key={courseValue(item)}
                            value={courseValue(item)}
                          >
                            {item.label ??
                              `${item.coursePrefix} ${item.courseNumber}`}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  aria-label="Include Instructor Basis"
                  checked={instructorEnabled}
                  disabled={!instructors.length && !instructorEnabled}
                  id={`${inputId}-instructor-enabled`}
                  onCheckedChange={(checked) =>
                    setInstructorEnabled(checked === true)
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${inputId}-instructor-enabled`}>
                    Instructor
                  </FieldLabel>
                  <Select
                    disabled={!instructorEnabled}
                    name="instructorUuid"
                    onValueChange={setInstructorUuid}
                    value={instructorUuid}
                  >
                    <SelectTrigger aria-label="Instructor Basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {displayedInstructors.map((item) => (
                          <SelectItem
                            key={item.instructorUuid}
                            value={item.instructorUuid}
                          >
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
            </FieldGroup>
            {!hasBasis ? (
              <FieldError>Select at least one Review Basis.</FieldError>
            ) : null}
          </FieldSet>
          <FieldSet className="min-w-0 gap-4 rounded-xl border border-gray-200 p-4">
            <FieldLegend>
              Review Context{" "}
              <span className="font-normal text-gray-500">(optional)</span>
            </FieldLegend>
            <input name="termCode" type="hidden" value={termCode} />
            <input name="section" type="hidden" value={section} />
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${inputId}-term`}>Term</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    setTermCode(value === "general" ? "" : value);
                    setSection("");
                  }}
                  value={termCode || "general"}
                >
                  <SelectTrigger id={`${inputId}-term`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="general">General</SelectItem>
                      {displayedTerms.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-disabled={!courseEnabled || !termCode}>
                <FieldLabel htmlFor={`${inputId}-section`}>Section</FieldLabel>
                <Select
                  disabled={!courseEnabled || !termCode}
                  onValueChange={(value) =>
                    setSection(value === "all" ? "" : value)
                  }
                  value={section || "all"}
                >
                  <SelectTrigger id={`${inputId}-section`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All Sections</SelectItem>
                      {displayedSections.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <FieldDescription>
              Term qualifies every selected Review Basis. Section requires a
              Course Basis and Term and identifies a Class.
            </FieldDescription>
            {edit && !selectionSupported ? (
              <FieldError>
                This Review snapshot is no longer source-backed. Select
                supported Review Bases and Review Context before publishing.
                Persisted values are shown as the current snapshot and will not
                be removed automatically.
              </FieldError>
            ) : null}
          </FieldSet>
          <Field>
            <FieldLabel>Review</FieldLabel>
            <input name="markdown" type="hidden" value={markdown} />
            <ReviewMarkdownEditor
              markdown={markdown}
              onChange={setMarkdown}
              uploadImage={uploadImage}
            />
            <FieldDescription>
              Write with the toolbar. Paste or drop images to upload and embed
              them as Attachments.
            </FieldDescription>
          </Field>
          <FieldSet className="min-w-0 gap-4 rounded-xl border border-gray-200 p-4">
            <FieldLegend>Attachments</FieldLegend>
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
            <FieldDescription className="text-amber-950">
              Embedded metadata is preserved and may expose names, device
              information, or location. UST Rankings does not resize, strip,
              transcode, or malware-scan files. Strict format validation is not
              antivirus assurance. Accepted JPEG, PNG, GIF, WebP, HEIC/HEIF,
              PDF, TXT, Markdown, CSV, macro-free DOCX/XLSX/PPTX, and
              ODT/ODS/ODP files count toward a 32 MiB distinct Stored File
              quota, including pending uploads. A Revision has at most four
              Attachments. Review text can publish while an upload is pending.
            </FieldDescription>
            <Input
              accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.pdf,.txt,.md,.csv,.docx,.xlsx,.pptx,.odt,.ods,.odp,image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,application/pdf,text/plain,text/markdown,text/csv"
              aria-label="Add Attachments"
              disabled={attachments.length >= 4}
              multiple
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
              type="file"
            />
            {attachments.map((attachment) => (
              <FieldGroup className="gap-2" key={attachment.id}>
                <p className="text-sm">
                  {attachment.filename} · {attachment.status}
                </p>
                <Field>
                  <FieldLabel
                    htmlFor={`${inputId}-${attachment.id}-description`}
                  >
                    Description
                  </FieldLabel>
                  <Input
                    id={`${inputId}-${attachment.id}-description`}
                    onChange={(event) =>
                      updateAttachments((current) =>
                        current.map((item) =>
                          item.id === attachment.id
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={attachment.description}
                  />
                </Field>
              </FieldGroup>
            ))}
            <FieldDescription>
              Attachments are not licensed under CC BY 4.0. You warrant you have
              the right to upload them and grant UST Rankings a non-exclusive
              license to store, deliver, display, and moderate them.
            </FieldDescription>
          </FieldSet>
          <FieldSet className="min-w-0 gap-4 rounded-xl border border-gray-200 p-4">
            <FieldLegend>Public identity</FieldLegend>
            <input name="attribution" type="hidden" value={attribution} />
            <ToggleGroup
              aria-label="Public identity"
              className="grid grid-cols-2"
              onValueChange={(value) => {
                if (value) setAttribution(value as ReviewAttribution);
              }}
              type="single"
              value={attribution}
              variant="outline"
            >
              <ToggleGroupItem value="attributed">Attributed</ToggleGroupItem>
              <ToggleGroupItem value="identity-hidden">
                Identity hidden
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              Attributed displays your current Public Display Name. Identity
              hidden displays no author name, but an authorized operator can
              still link the Review to your account for moderation, security,
              rights, and legal purposes.
            </FieldDescription>
          </FieldSet>
          <Alert className="bg-blue-50 text-blue-950">
            <AlertDescription>
              {edit
                ? "Publishing this edit creates a new immutable Review Revision. Earlier Revisions remain internal."
                : "Publishing creates an immutable Review Revision."}{" "}
              Attribution is selected independently for each Revision.
            </AlertDescription>
          </Alert>
          <Alert className="bg-amber-50 text-amber-950">
            <AlertDescription>
              Review text is published under CC BY 4.0. Attributed credit uses
              your captured Public Display Name plus the Review permalink;
              Identity-hidden credit uses “UST Rankings contributor” plus the
              permalink. You also grant UST Rankings a non-exclusive site
              license to host, format, display, and moderate it. CC BY 4.0
              rights already granted to obtained copies cannot be recalled, even
              after withdrawal.
            </AlertDescription>
          </Alert>
          <DialogFooter className="gap-2 border-t border-slate-200 pt-5">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={
                !hasBasis || !markdown.trim() || (edit && !selectionSupported)
              }
              type="submit"
            >
              Publish Revision
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  displayTermNames = false,
}: {
  reviews: PublicReview[];
  editor?: ReviewEditorOptions;
  displayTermNames?: boolean;
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
        const credit = review.capturedDisplayName ?? review.attributionCredit;
        return (
          <li
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            id={`review-${review.id}`}
            key={review.id}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
              <p className="font-bold">
                {identityHidden ? <i>Anonymous Reviewer</i> : credit}
              </p>
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
                Review Context · Term{" "}
                {displayTermNames
                  ? rankingTermName(review.termCode)
                  : review.termCode}
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
              <ul className="mt-4 space-y-2 text-sm">
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
                          This file has not been malware-scanned. Open it only
                          if you trust the author. Strict format validation is
                          not antivirus assurance.
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
            <p className="mt-4 text-xs text-slate-500">
              Review text licensed {review.license ?? "CC BY 4.0"} ·{" "}
              <a href={permalink}>Review permalink</a>
            </p>
            <form action={reportReview} className="mt-3">
              <input name="reviewId" type="hidden" value={review.id} />
              {associationFields(review)}
              <label className="block text-sm">
                Report this Review
                <select
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"
                  name="reasonCategory"
                  required
                >
                  <option value="">Select a reason</option>
                  {REPORT_REASON_CATEGORIES.map((reason) => (
                    <option key={reason} value={reason}>
                      {REPORT_REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-xs text-slate-600">
                Reporter identity stays private and is never shown to the author
                or the public. There is no public moderation log.
              </p>
              <button
                className="mt-2 min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-bold"
                type="submit"
              >
                Report Review
              </button>
            </form>
            {review.viewerCanEdit && editor ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <ReviewComposer
                  {...editor}
                  displayTermNames={displayTermNames}
                  review={review}
                />
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
