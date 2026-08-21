import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { instructorPath } from "@/app/instructors/routes";
import { SignalControls } from "@/app/signals/signal-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { PublicReview } from "@/lib/contributions/reviews";
import type { SignalSummary } from "@/lib/contributions/signals";
import { rankingTermName } from "@/lib/rankings/presentation";
import type { CourseRankings } from "@/lib/rankings/server";
import type {
  CourseOffering,
  ScheduleDetails,
  ScheduleMeeting,
} from "@/lib/schedule/server";
import { ReviewComposer, type ReviewEditorOptions } from "./course-reviews";
import styles from "./details.module.css";
import {
  DetailsCommunity,
  DetailsHeader,
  DetailsRankings,
  ExpandCardTrigger,
} from "./details-sections";
import { coursePath } from "./routes";

function uniqueInstructors(
  offerings: CourseOffering[],
  rankings?: CourseRankings,
) {
  const instructors = new Map<
    string,
    { name: string; uuid?: string; itsc?: string; termCodes: Set<string> }
  >();
  for (const offering of offerings)
    for (const meeting of offering.classes.flatMap((item) => item.meetings))
      for (const instructor of meeting.instructors) {
        const resolvedUuid = rankings?.instructors.some(
          (association) =>
            association.termCode === offering.termCode &&
            association.instructor.uuid === instructor.uuid,
        )
          ? instructor.uuid
          : undefined;
        const key = resolvedUuid ?? instructor.sourceName;
        const current = instructors.get(key) ?? {
          name: instructor.sourceName,
          uuid: resolvedUuid,
          termCodes: new Set(),
        };
        current.termCodes.add(offering.termCode);
        instructors.set(key, current);
      }
  for (const association of rankings?.instructors ?? []) {
    const instructor = association.instructor;
    const current = instructors.get(instructor.uuid) ?? {
      name: instructor.canonicalName,
      uuid: instructor.uuid,
      itsc: instructor.itsc,
      termCodes: new Set(),
    };
    current.itsc ??= instructor.itsc;
    current.termCodes.add(association.termCode);
    instructors.set(instructor.uuid, current);
  }
  return [...instructors.values()];
}

function ClassLinks({ offering }: { offering: CourseOffering }) {
  return (
    <div className="flex flex-col gap-3">
      {offering.classes.map((scheduleClass) => (
        <section
          className="flex flex-col gap-1"
          key={scheduleClass.classNumber}
        >
          <h3 className="font-semibold text-balance">
            <Link
              className={`${styles.sidebarLink} inline-flex items-center gap-1`}
              href={coursePath(
                offering.coursePrefix,
                offering.courseNumber,
                offering.termCode,
                scheduleClass.section,
              )}
              rel="noopener noreferrer"
              target="_blank"
            >
              {offering.courseCode} {scheduleClass.section} (
              {scheduleClass.classNumber})
              <ArrowUpRight aria-hidden="true" className="size-3" />
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          </h3>
          <p className="text-sm text-slate-600 tabular-nums">
            {scheduleClass.enrollment} of {scheduleClass.capacity} enrolled
          </p>
        </section>
      ))}
    </div>
  );
}

export function UnavailableDetail({
  entity,
  title,
}: {
  entity: "Course Offering" | "Class";
  title: string;
}) {
  return (
    <div className="w-full text-left text-slate-900">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
        {entity}
      </p>
      <h1 className="mt-2 text-4xl font-black tracking-tight">{title}</h1>
      <section
        className="mt-8 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950"
        role="alert"
      >
        <h2 className="text-xl font-bold">Schedule details are unavailable</h2>
        <p className="mt-2">
          This {entity} relationship cannot be checked while the independent
          Schedule provider is unavailable. Rankings and other public pages
          remain available.
        </p>
      </section>
    </div>
  );
}

export function CourseDetails({
  coursePrefix,
  courseNumber,
  schedule,
  rankings,
  selectedTermCode,
  reviews = [],
  reviewsUnavailable = true,
  reviewPublished,
  reviewWithdrawn,
  reviewError,
  signals,
  signalsUnavailable = true,
  signedIn = false,
  signalError,
}: {
  coursePrefix: string;
  courseNumber: string;
  schedule?: Extract<ScheduleDetails, { type: "course" }>;
  rankings?: CourseRankings;
  selectedTermCode?: string;
  reviews?: PublicReview[];
  reviewsUnavailable?: boolean;
  reviewPublished?: boolean;
  reviewWithdrawn?: boolean;
  reviewError?: string;
  signals?: SignalSummary;
  signalsUnavailable?: boolean;
  signedIn?: boolean;
  signalError?: string;
}) {
  const offerings = schedule?.offerings ?? [];
  const selectedOffering = selectedTermCode
    ? offerings.find((offering) => offering.termCode === selectedTermCode)
    : offerings.at(-1);
  const currentOffering = selectedOffering ?? offerings.at(-1);
  const evidenceTermCode =
    selectedTermCode ??
    currentOffering?.termCode ??
    rankings?.population.termCode;
  const title =
    currentOffering?.title ??
    rankings?.course.title ??
    "Catalog details unavailable";
  const termNames = new Map(
    offerings.map((offering) => [offering.termCode, offering.termName]),
  );
  const instructors = uniqueInstructors(offerings, rankings);
  const currentInstructors = evidenceTermCode
    ? instructors
        .filter((instructor) => instructor.termCodes.has(evidenceTermCode))
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  const earlierTeachings = instructors
    .flatMap((instructor) => {
      const terms = [...instructor.termCodes].filter(
        (termCode) => termCode !== evidenceTermCode,
      );
      return terms.length ? [{ instructor, terms }] : [];
    })
    .sort(
      (left, right) =>
        (right.terms.toSorted().at(-1) ?? "").localeCompare(
          left.terms.toSorted().at(-1) ?? "",
        ) || left.instructor.name.localeCompare(right.instructor.name),
    );
  const earlierOfferings = currentOffering
    ? offerings.filter(
        (offering) => offering.termCode !== currentOffering.termCode,
      )
    : [];
  const reviewEditor: ReviewEditorOptions = {
    courses: [{ coursePrefix, courseNumber }],
    instructors: instructors.flatMap((item) =>
      item.uuid ? [{ instructorUuid: item.uuid, name: item.name }] : [],
    ),
    contexts: offerings.flatMap((offering) => {
      const course = { coursePrefix, courseNumber };
      const courseContexts = [
        {
          course,
          termCode: offering.termCode,
          termName: offering.termName,
        },
        ...offering.classes.map((item) => ({
          course,
          termCode: offering.termCode,
          termName: offering.termName,
          section: item.section,
        })),
      ];
      const instructorContexts =
        rankings?.instructors
          .filter((item) => item.termCode === offering.termCode)
          .flatMap((item) => [
            {
              course,
              instructorUuid: item.instructor.uuid,
              termCode: offering.termCode,
              termName: offering.termName,
            },
            ...offering.classes
              .filter((scheduleClass) =>
                scheduleClass.meetings.some((meeting) =>
                  meeting.instructors.some(
                    (instructor) => instructor.uuid === item.instructor.uuid,
                  ),
                ),
              )
              .map((scheduleClass) => ({
                course,
                instructorUuid: item.instructor.uuid,
                termCode: offering.termCode,
                termName: offering.termName,
                section: scheduleClass.section,
              })),
          ]) ?? [];
      return [...courseContexts, ...instructorContexts];
    }),
  };
  const instructorEntry = (
    instructor: (typeof instructors)[number],
    terms: string[],
  ) => (
    <section
      className="flex flex-col gap-1"
      key={instructor.uuid ?? instructor.name}
    >
      <h3 className="font-semibold text-balance">
        {instructor.uuid ? (
          <Link
            className={`${styles.sidebarLink} inline-flex items-center gap-1`}
            href={instructorPath({
              itsc: instructor.itsc,
              uuid: instructor.uuid,
            })}
            rel="noopener noreferrer"
            target="_blank"
          >
            {instructor.name}
            <ArrowUpRight aria-hidden="true" className="size-3" />
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        ) : (
          instructor.name
        )}
      </h3>
      <p className="text-sm text-slate-700">
        {terms
          .slice()
          .sort()
          .reverse()
          .map(
            (termCode) => termNames.get(termCode) ?? rankingTermName(termCode),
          )
          .join(" · ")}
      </p>
    </section>
  );
  const offeringEntry = (offering: CourseOffering) => (
    <section className="flex flex-col gap-3" key={offering.termCode}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-balance">
          <Link
            className={`${styles.sidebarLink} inline-flex items-center gap-1`}
            href={coursePath(
              offering.coursePrefix,
              offering.courseNumber,
              offering.termCode,
            )}
            rel="noopener noreferrer"
            target="_blank"
          >
            {offering.termName}
            <ArrowUpRight aria-hidden="true" className="size-3" />
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </h3>
        <p className="text-sm text-slate-600">{offering.credits} credits</p>
      </div>
      {offering.classes.length ? (
        <div className="flex flex-col gap-3">
          {offering.classes.map((scheduleClass) => (
            <section
              className="flex flex-col gap-1"
              key={scheduleClass.classNumber}
            >
              <h4 className="font-medium">
                <Link
                  className={`${styles.sidebarLink} inline-flex items-center gap-1`}
                  href={coursePath(
                    offering.coursePrefix,
                    offering.courseNumber,
                    offering.termCode,
                    scheduleClass.section,
                  )}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {offering.courseCode} {scheduleClass.section} (
                  {scheduleClass.classNumber})
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </h4>
              <p className="text-sm text-slate-600 tabular-nums">
                {scheduleClass.enrollment} of {scheduleClass.capacity} enrolled
              </p>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No Classes are reported.</p>
      )}
    </section>
  );
  return (
    <div className="flex w-full flex-col gap-8 text-left text-slate-900">
      <DetailsHeader
        description={currentOffering?.description}
        eyebrow="Course"
        subtitle={title}
        termName={
          termNames.get(evidenceTermCode ?? "") ??
          rankingTermName(evidenceTermCode)
        }
        title={`${coursePrefix} ${courseNumber}`}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section
          aria-label="Rankings and Community"
          className="flex min-w-0 flex-col gap-6"
        >
          <DetailsRankings
            rankings={rankings}
            scoreDistribution={rankings?.scoreDistribution}
            selectedTermCode={evidenceTermCode}
            termNames={termNames}
          />
          <DetailsCommunity
            description="Published experiences and signals for this Course."
            editor={reviewEditor}
            error={reviewError}
            published={reviewPublished}
            reviewComposer={
              <ReviewComposer
                {...reviewEditor}
                displayTermNames
                initialCourse={{ coursePrefix, courseNumber }}
                initialTermCode={evidenceTermCode}
              />
            }
            reviews={reviews}
            reviewsUnavailable={reviewsUnavailable}
            signalControls={
              <SignalControls
                error={signalError}
                signedIn={signedIn}
                summary={signals}
                target={{ type: "course", coursePrefix, courseNumber }}
                unavailable={signalsUnavailable}
              />
            }
            withdrawn={reviewWithdrawn}
          />
        </section>
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
          <Collapsible className="group">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle asChild className={styles.heading}>
                  <h2>Teachings</h2>
                </CardTitle>
                <ExpandCardTrigger
                  count={earlierTeachings.length}
                  label="Teachings"
                />
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {currentInstructors.length ? (
                  currentInstructors.map((instructor) =>
                    instructorEntry(
                      instructor,
                      evidenceTermCode ? [evidenceTermCode] : [],
                    ),
                  )
                ) : (
                  <p className="text-sm text-slate-700">
                    No teaching is reported for this Term.
                  </p>
                )}
                <CollapsibleContent className="flex flex-col gap-5">
                  {earlierTeachings.map(({ instructor, terms }) =>
                    instructorEntry(instructor, terms),
                  )}
                </CollapsibleContent>
              </CardContent>
            </Card>
          </Collapsible>
          <Collapsible className="group">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle asChild className={styles.heading}>
                  <h2>Offerings</h2>
                </CardTitle>
                <ExpandCardTrigger
                  count={earlierOfferings.length}
                  label="Offerings"
                />
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {currentOffering ? (
                  offeringEntry(currentOffering)
                ) : (
                  <p className="text-sm text-amber-900">
                    Offerings are unavailable. Rankings and Community remain
                    available.
                  </p>
                )}
                <CollapsibleContent className="flex flex-col gap-6">
                  {[...earlierOfferings].reverse().map(offeringEntry)}
                </CollapsibleContent>
              </CardContent>
            </Card>
          </Collapsible>
        </aside>
      </div>
    </div>
  );
}

export function CourseOfferingDetails({
  offering,
  rankings,
  reviews = [],
  reviewsUnavailable = true,
}: {
  offering: Extract<ScheduleDetails, { type: "course-offering" }>;
  rankings?: CourseRankings;
  reviews?: PublicReview[];
  reviewsUnavailable?: boolean;
}) {
  const instructors = uniqueInstructors([offering], rankings).filter((item) =>
    item.termCodes.has(offering.termCode),
  );
  const course = {
    coursePrefix: offering.coursePrefix,
    courseNumber: offering.courseNumber,
  };
  const instructorOptions = instructors.flatMap((instructor) =>
    instructor.uuid
      ? [{ instructorUuid: instructor.uuid, name: instructor.name }]
      : [],
  );
  const courseContexts: ReviewEditorOptions["contexts"] = [
    { course, termCode: offering.termCode, termName: offering.termName },
    ...offering.classes.map((scheduleClass) => ({
      course,
      termCode: offering.termCode,
      termName: offering.termName,
      section: scheduleClass.section,
    })),
  ];
  const reviewEditor: ReviewEditorOptions = {
    courses: [course],
    instructors: instructorOptions,
    contexts: [
      ...courseContexts,
      ...instructorOptions.flatMap((instructor) => [
        {
          instructorUuid: instructor.instructorUuid,
          termCode: offering.termCode,
          termName: offering.termName,
        },
        ...courseContexts.map((context) => ({
          ...context,
          instructorUuid: instructor.instructorUuid,
        })),
      ]),
    ],
  };
  return (
    <div className="flex w-full flex-col gap-8 text-left text-slate-900">
      <DetailsHeader
        description={offering.description}
        eyebrow="Course Offering"
        subtitle={offering.title}
        termName={offering.termName}
        title={offering.courseCode}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section
          aria-label="Rankings and Community"
          className="flex min-w-0 flex-col gap-6"
        >
          <DetailsRankings
            rankings={rankings}
            scoreDistribution={rankings?.scoreDistribution}
            selectedTermCode={offering.termCode}
            termNames={new Map([[offering.termCode, offering.termName]])}
          />
          <DetailsCommunity
            description="Published experiences for this Course Offering and its Review Bases."
            editor={reviewEditor}
            reviewComposer={
              <ReviewComposer
                {...reviewEditor}
                displayTermNames
                initialCourse={course}
                initialTermCode={offering.termCode}
              />
            }
            reviews={reviews}
            reviewsUnavailable={reviewsUnavailable}
            signalControls={
              <p className="text-sm text-slate-600" id="signals">
                This Course Offering is Review Context, not a signal target.
                Signals belong to its Review Bases.
              </p>
            }
          />
        </section>
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle asChild className={styles.heading}>
                <h2>Offering Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-slate-600">
                {offering.credits} credits · {offering.career}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle asChild className={styles.heading}>
                <h2>Classes</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {offering.classes.length ? (
                <ClassLinks offering={offering} />
              ) : (
                <p className="text-sm text-slate-600">
                  No Classes are reported.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle asChild className={styles.heading}>
                <h2>Teachings</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {instructors.length ? (
                <div className="flex flex-col gap-3 text-sm text-slate-700">
                  {instructors.map((instructor) => (
                    <section
                      className="flex flex-col gap-1"
                      key={instructor.uuid ?? instructor.name}
                    >
                      <h3 className="font-semibold text-balance">
                        {instructor.uuid ? (
                          <Link
                            className={`${styles.sidebarLink} inline-flex items-center gap-1`}
                            href={instructorPath({
                              itsc: instructor.itsc,
                              uuid: instructor.uuid,
                            })}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {instructor.name}
                            <ArrowUpRight
                              aria-hidden="true"
                              className="size-3"
                            />
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </Link>
                        ) : (
                          `${instructor.name} (unresolved source name)`
                        )}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {offering.termName}
                      </p>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  No Instructor association is available.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function meetingLabel(meeting: ScheduleMeeting) {
  const time =
    meeting.timeFrom && meeting.timeTo
      ? `${meeting.timeFrom}–${meeting.timeTo}`
      : "Time TBA";
  return `${meeting.weekday} ${time} · ${meeting.room || "Room TBA"}`;
}

export function ClassDetails({
  scheduleClass,
  rankings,
  reviews = [],
  reviewsUnavailable = true,
}: {
  scheduleClass: Extract<ScheduleDetails, { type: "class" }>;
  rankings?: CourseRankings;
  reviews?: PublicReview[];
  reviewsUnavailable?: boolean;
}) {
  const instructors = new Map<string, { name: string; uuid?: string }>();
  for (const meeting of scheduleClass.meetings)
    for (const instructor of meeting.instructors) {
      const resolvedUuid = rankings?.instructors.some(
        (association) =>
          association.termCode === scheduleClass.termCode &&
          association.instructor.uuid === instructor.uuid,
      )
        ? instructor.uuid
        : undefined;
      instructors.set(resolvedUuid ?? instructor.sourceName, {
        name: instructor.sourceName,
        uuid: resolvedUuid,
      });
    }
  const instructorOptions = [...instructors.values()].flatMap((instructor) =>
    instructor.uuid
      ? [{ instructorUuid: instructor.uuid, name: instructor.name }]
      : [],
  );
  const course = {
    coursePrefix: scheduleClass.coursePrefix,
    courseNumber: scheduleClass.courseNumber,
  };
  const termName = rankingTermName(scheduleClass.termCode);
  const contexts: ReviewEditorOptions["contexts"] = [
    {
      course,
      termCode: scheduleClass.termCode,
      termName,
      section: scheduleClass.section,
    },
    ...instructorOptions.map((instructor) => ({
      course,
      instructorUuid: instructor.instructorUuid,
      termCode: scheduleClass.termCode,
      termName,
      section: scheduleClass.section,
    })),
  ];
  const reviewEditor: ReviewEditorOptions = {
    courses: [course],
    contexts,
    instructors: instructorOptions,
  };
  return (
    <div className="flex w-full flex-col gap-8 text-left text-slate-900">
      <DetailsHeader
        description={scheduleClass.courseDescription}
        eyebrow="Class"
        subtitle={scheduleClass.courseTitle}
        termName={termName}
        title={`${scheduleClass.courseCode} ${scheduleClass.section} (${scheduleClass.classNumber})`}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section
          aria-label="Rankings and Community"
          className="flex min-w-0 flex-col gap-6"
        >
          <DetailsRankings
            rankings={rankings}
            scoreDistribution={rankings?.scoreDistribution}
            selectedTermCode={scheduleClass.termCode}
            termNames={new Map([[scheduleClass.termCode, termName]])}
          />
          <DetailsCommunity
            description="Published experiences for this Class context and its Review Bases."
            editor={reviewEditor}
            reviewComposer={
              <ReviewComposer
                {...reviewEditor}
                displayTermNames
                initialCourse={course}
                initialSection={scheduleClass.section}
                initialTermCode={scheduleClass.termCode}
              />
            }
            reviews={reviews}
            reviewsUnavailable={reviewsUnavailable}
            signalControls={
              <div className="flex flex-col gap-3 text-sm" id="signals">
                <p className="text-slate-600">
                  This Class is Review Context, not a signal target. Signals
                  belong to its Review Bases.
                </p>
                <div className="flex flex-wrap gap-2 font-semibold">
                  <Link
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5"
                    href={`${coursePath(scheduleClass.coursePrefix, scheduleClass.courseNumber)}#signals`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Course Basis
                    <ArrowUpRight aria-hidden="true" className="size-3" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                  {instructorOptions.map((instructor) => (
                    <Link
                      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5"
                      href={`${instructorPath(instructor.instructorUuid)}#signals`}
                      key={instructor.instructorUuid}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Instructor Basis · {instructor.name}
                      <ArrowUpRight aria-hidden="true" className="size-3" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </Link>
                  ))}
                </div>
              </div>
            }
          />
        </section>
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle asChild className={styles.heading}>
                <h2>Class Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-semibold text-slate-600">Enrollment</dt>
                  <dd className="tabular-nums">
                    {scheduleClass.enrollment} / {scheduleClass.capacity}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">Waitlist</dt>
                  <dd className="tabular-nums">{scheduleClass.waitlist}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">Status</dt>
                  <dd>{scheduleClass.open ? "Open" : "Closed"}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">Type</dt>
                  <dd>{scheduleClass.classType}</dd>
                </div>
              </dl>
              <section className="flex flex-col gap-3">
                <h3 className="font-semibold">Meetings</h3>
                {scheduleClass.meetings.length ? (
                  scheduleClass.meetings.map((meeting) => (
                    <div className="text-sm" key={JSON.stringify(meeting)}>
                      <p className="font-medium">{meetingLabel(meeting)}</p>
                      <p className="text-slate-600">
                        {meeting.dateFrom ?? "Dates TBA"}
                        {meeting.dateTo ? `–${meeting.dateTo}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-600">Meeting TBA</p>
                )}
              </section>
              {scheduleClass.reservations.length ? (
                <section className="flex flex-col gap-2 text-sm">
                  <h3 className="font-semibold">Reservations</h3>
                  {scheduleClass.reservations.map((reservation) => (
                    <p key={reservation.name}>
                      {reservation.name}: {reservation.enrollment}/
                      {reservation.quota}
                    </p>
                  ))}
                </section>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle asChild className={styles.heading}>
                <h2>Review Bases</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>
                Course ·{" "}
                <Link
                  className={`${styles.sidebarLink} inline-flex items-center gap-1 font-semibold`}
                  href={coursePath(
                    scheduleClass.coursePrefix,
                    scheduleClass.courseNumber,
                  )}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {scheduleClass.courseCode}
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </p>
              {instructors.size ? (
                [...instructors.values()].map((instructor) => (
                  <p key={instructor.uuid ?? instructor.name}>
                    Instructor ·{" "}
                    {instructor.uuid ? (
                      <Link
                        className={`${styles.sidebarLink} inline-flex items-center gap-1 font-semibold`}
                        href={instructorPath(instructor.uuid)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {instructor.name}
                        <ArrowUpRight aria-hidden="true" className="size-3" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </Link>
                    ) : (
                      `${instructor.name} (unresolved source name)`
                    )}
                  </p>
                ))
              ) : (
                <p>No Instructor association</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
