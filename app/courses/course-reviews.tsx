"use client";

import dynamic from "next/dynamic";
import {
  type ReactElement,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
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
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { contentTypeForFilename } from "@/lib/attachments/attachments";
import type {
  PublicReview,
  ReviewAssociations,
  ReviewAttribution,
} from "@/lib/contributions/reviews";
import { rankingTermName } from "@/lib/rankings/presentation";
import { editReview, publishReview, withdrawReview } from "./review-actions";
import { associationFields, ReviewCard } from "./review-card";
import { ReviewOrderSelect } from "./review-order-select";

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

const allCourses = "all-courses";
const allInstructors = "all-instructors";

type DraftAttachment = {
  id: string;
  storedFileId: string;
  filename: string;
  description: string;
  status: "ready" | "pending" | "failed";
  kind?: "image" | "document";
};

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
  trigger,
}: ReviewEditorOptions & {
  initialCourse?: ReviewCourseOption;
  initialInstructorUuid?: string;
  initialTermCode?: string;
  initialSection?: string;
  review?: PublicReview;
  displayTermNames?: boolean;
  trigger?: ReactElement;
}) {
  const edit = Boolean(review);
  const selectedInitialCourse = review?.course ?? initialCourse;
  const selectedInitialInstructor =
    review?.instructorUuid ?? initialInstructorUuid;
  const [course, setCourse] = useState(
    selectedInitialCourse ? courseValue(selectedInitialCourse) : allCourses,
  );
  const [instructorUuid, setInstructorUuid] = useState(
    selectedInitialInstructor ?? allInstructors,
  );
  const courseEnabled = course !== allCourses;
  const instructorEnabled = instructorUuid !== allInstructors;
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
    () =>
      [
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
      ].sort(([left], [right]) => right.localeCompare(left)),
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
  const [publishState, publishAction, publishPending] = useActionState(
    publishReview,
    null,
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            className="h-auto p-0 text-xs font-bold uppercase tracking-[0.16em] text-slate-600 underline underline-offset-4 hover:text-slate-900"
            type="button"
            variant="link"
          >
            {edit ? "Edit Review" : "Create a Review"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-hidden p-0 text-left">
        <form
          action={edit ? editReview : publishAction}
          className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-5 overflow-x-hidden overflow-y-auto p-6 sm:p-8"
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
              Choose at least one Review Basis, then optional Review Context.
            </DialogDescription>
          </DialogHeader>
          <FieldSet className="min-w-0 gap-3 rounded-xl border border-gray-200 p-4">
            <FieldLegend className="mb-0">Review Basis</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${inputId}-course`}>Course</FieldLabel>
                <Select name="course" onValueChange={setCourse} value={course}>
                  <SelectTrigger id={`${inputId}-course`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allCourses}>(All courses)</SelectItem>
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
              </Field>
              <Field>
                <FieldLabel htmlFor={`${inputId}-instructor`}>
                  Instructor
                </FieldLabel>
                <Select
                  name="instructorUuid"
                  onValueChange={setInstructorUuid}
                  value={instructorUuid}
                >
                  <SelectTrigger id={`${inputId}-instructor`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allInstructors}>
                        (All instructors)
                      </SelectItem>
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
              </Field>
              {!hasBasis ? (
                <FieldError className="sm:col-span-2">
                  Select at least one Review Basis.
                </FieldError>
              ) : null}
            </FieldGroup>
          </FieldSet>
          {hasBasis ? (
            <>
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
                      <SelectContent className="max-h-64">
                        <SelectGroup>
                          <SelectItem value="general">(All terms)</SelectItem>
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
                    <FieldLabel htmlFor={`${inputId}-section`}>
                      Section
                    </FieldLabel>
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
                          <SelectItem value="all">(All sections)</SelectItem>
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
                {edit && !selectionSupported ? (
                  <FieldError>
                    This Review snapshot is no longer source-backed. Select
                    supported Review Bases and Review Context before publishing.
                    Persisted values are shown as the current snapshot and will
                    not be removed automatically.
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
                  Write with the toolbar, or switch to Markdown to edit the
                  source. Paste or drop images to upload and embed them as
                  Attachments.
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
                  <p className="text-sm" key={attachment.id}>
                    {attachment.filename} · {attachment.status}
                  </p>
                ))}
              </FieldSet>
              <div className="flex flex-col">
                <FieldSet className="min-w-0 gap-4 rounded-b-none rounded-t-xl border border-gray-200 p-4">
                  <FieldLegend>Public Identity</FieldLegend>
                  <input name="attribution" type="hidden" value={attribution} />
                  <ToggleGroup
                    aria-label="Public Identity"
                    className="grid grid-cols-2 gap-3"
                    onValueChange={(value) => {
                      if (value) setAttribution(value as ReviewAttribution);
                    }}
                    type="single"
                    value={attribution}
                    variant="outline"
                  >
                    <ToggleGroupItem value="attributed">
                      Attributed
                    </ToggleGroupItem>
                    <ToggleGroupItem value="identity-hidden">
                      Identity Hidden
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    Attributed displays your current public display name.
                    Identity Hidden displays no author name, but an authorized
                    operator can still link the Review to your account for
                    moderation, security, rights, and legal purposes.
                  </FieldDescription>
                </FieldSet>
                <Alert className="rounded-t-none border-t-0 bg-amber-50 text-amber-950">
                  <AlertDescription className="mt-0">
                    Your review text is licensed under{" "}
                    <a
                      className="font-semibold underline"
                      href="https://creativecommons.org/licenses/by/4.0/"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      CC BY 4.0
                    </a>
                    . For attributed reviews, it credits your captured public
                    display name and review permalink. For identity-hidden
                    reviews, it credits &quot;Anonymous Reviewer&quot; and the
                    review permalink.
                  </AlertDescription>
                </Alert>
              </div>
            </>
          ) : null}
          {publishState?.error === "duplicate-review" ? (
            <Alert variant="destructive">
              <AlertDescription className="mt-0">
                You already have an active Review for the selected Review Basis.
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="gap-2 border-t border-slate-200 pt-5">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={
                !hasBasis ||
                !markdown.trim() ||
                (edit && !selectionSupported) ||
                publishPending
              }
              type="submit"
            >
              Publish
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawReviewDialog({ review }: { review: PublicReview }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          className="h-auto p-0 text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900"
          type="button"
          variant="link"
        >
          Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md overflow-hidden overscroll-contain p-0">
        <form action={withdrawReview} className="flex flex-col">
          <input name="reviewId" type="hidden" value={review.id} />
          <input
            name="expectedRevisionId"
            type="hidden"
            value={review.revisionId}
          />
          {associationFields(review)}
          <DialogHeader className="gap-3 px-6 pt-6 pr-12 pb-3">
            <DialogTitle>Withdraw this Review?</DialogTitle>
            <DialogDescription className="leading-6">
              It will disappear from public display. Justified immutable
              revisions remain internal, and existing CC BY 4.0 copies cannot be
              recalled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 border-t border-gray-200 bg-gray-50 p-4 sm:px-6 [&_button]:w-full sm:[&_button]:w-auto">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep Review
              </Button>
            </DialogClose>
            <Button
              className="bg-red-700 hover:bg-red-800"
              type="submit"
              variant="destructive"
            >
              Withdraw Review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Reviews({
  reviews,
  editor,
  displayTermNames = false,
  showOrder = true,
}: {
  reviews: PublicReview[];
  editor?: ReviewEditorOptions;
  displayTermNames?: boolean;
  showOrder?: boolean;
}) {
  const names = new Map(
    (editor?.instructors ?? []).map((instructor) => [
      instructor.instructorUuid,
      instructor.name,
    ]),
  );
  return (
    <div className="flex flex-col gap-5">
      {showOrder ? (
        <div className="flex justify-end">
          <ReviewOrderSelect />
        </div>
      ) : null}
      {reviews.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No reviews yet</EmptyTitle>
            <EmptyDescription>
              No Reviews have been published yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="!m-0 flex !list-none flex-col gap-5">
          {reviews.map((review, index) => (
            <li className="flex flex-col gap-5" key={review.id}>
              {index ? <Separator /> : null}
              <ReviewCard
                displayTermNames={displayTermNames}
                instructorName={
                  review.instructorUuid
                    ? names.get(review.instructorUuid)
                    : undefined
                }
                review={review}
              >
                {review.viewerCanEdit && editor ? (
                  <>
                    <ReviewComposer
                      {...editor}
                      displayTermNames={displayTermNames}
                      review={review}
                      trigger={
                        <Button
                          className="h-auto p-0 text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900"
                          type="button"
                          variant="link"
                        >
                          Edit
                        </Button>
                      }
                    />
                    <WithdrawReviewDialog review={review} />
                  </>
                ) : null}
              </ReviewCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
