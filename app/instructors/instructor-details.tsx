import type { ReactNode } from "react";
import {
  ReviewComposer,
  type ReviewEditorOptions,
} from "@/app/courses/course-reviews";
import detailsStyles from "@/app/courses/details.module.css";
import {
  DetailsCommunity,
  DetailsHeader,
  DetailsRankings,
  ExpandCardTrigger,
} from "@/app/courses/details-sections";
import { coursePath } from "@/app/courses/routes";
import { EntityLink } from "@/app/entity-navigation";
import { SignalControls } from "@/app/signals/signal-controls";
import { instructorTitleTransitionName } from "@/app/transition-names";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { PublicReview } from "@/lib/contributions/reviews";
import type { SignalSummary } from "@/lib/contributions/signals";
import { rankingTermName } from "@/lib/rankings/presentation";
import type { InstructorIdentityLookup, Rankings } from "@/lib/rankings/server";
import type { ScheduleClass } from "@/lib/schedule/server";

function splitCourseCode(courseCode: string) {
  const [coursePrefix, courseNumber] = courseCode.split(" ");
  return { coursePrefix, courseNumber };
}

function classKey(scheduleClass: ScheduleClass) {
  return `${scheduleClass.termCode}-${scheduleClass.classNumber}`;
}

function CourseEntry({
  courseCode,
  termCodes,
}: {
  courseCode: string;
  termCodes: string[];
}) {
  const { coursePrefix, courseNumber } = splitCourseCode(courseCode);
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-semibold text-balance">
        <EntityLink
          className={`${detailsStyles.sidebarLink} inline-flex items-center gap-1`}
          href={coursePath(coursePrefix, courseNumber)}
        >
          {courseCode}
        </EntityLink>
      </h3>
      <p className="text-sm text-slate-600">
        {termCodes
          .slice()
          .sort()
          .reverse()
          .map((termCode) => rankingTermName(termCode))
          .join(" · ")}
      </p>
    </section>
  );
}

function ClassEntry({ scheduleClass }: { scheduleClass: ScheduleClass }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-semibold text-balance">
        <EntityLink
          className={`${detailsStyles.sidebarLink} inline-flex items-center gap-1`}
          href={coursePath(
            scheduleClass.coursePrefix,
            scheduleClass.courseNumber,
            scheduleClass.termCode,
            scheduleClass.section,
          )}
        >
          {scheduleClass.courseCode} {scheduleClass.section} (
          {scheduleClass.classNumber})
        </EntityLink>
      </h3>
      <p className="text-sm text-slate-600">
        {rankingTermName(scheduleClass.termCode)} · {scheduleClass.enrollment}{" "}
        of {scheduleClass.capacity} enrolled
      </p>
    </section>
  );
}

function TeachingCards({
  rankings,
  classes,
  selectedTermCode,
  scheduleUnavailable,
}: {
  rankings?: Rankings;
  classes: ScheduleClass[];
  selectedTermCode?: string;
  scheduleUnavailable: boolean;
}) {
  const courseTerms = new Map<string, Set<string>>();
  for (const association of [
    ...(rankings?.courses ?? []),
    ...classes.map((scheduleClass) => ({
      courseCode: scheduleClass.courseCode,
      termCode: scheduleClass.termCode,
    })),
  ]) {
    const terms = courseTerms.get(association.courseCode) ?? new Set<string>();
    terms.add(association.termCode);
    courseTerms.set(association.courseCode, terms);
  }
  const courses = [...courseTerms]
    .map(([courseCode, terms]) => ({ courseCode, termCodes: [...terms] }))
    .sort(
      (left, right) =>
        (right.termCodes.toSorted().at(-1) ?? "").localeCompare(
          left.termCodes.toSorted().at(-1) ?? "",
        ) || left.courseCode.localeCompare(right.courseCode),
    );
  const currentCourses = courses.filter(
    ({ termCodes }) => selectedTermCode && termCodes.includes(selectedTermCode),
  );
  const earlierCourses = courses.filter(
    ({ termCodes }) =>
      !selectedTermCode || !termCodes.includes(selectedTermCode),
  );
  const byLatestClass = (left: ScheduleClass, right: ScheduleClass) =>
    right.termCode.localeCompare(left.termCode) ||
    left.courseCode.localeCompare(right.courseCode) ||
    left.section.localeCompare(right.section);
  const currentClasses = selectedTermCode
    ? classes
        .filter((scheduleClass) => scheduleClass.termCode === selectedTermCode)
        .sort(byLatestClass)
    : [];
  const earlierClasses = classes
    .filter((scheduleClass) => scheduleClass.termCode !== selectedTermCode)
    .sort(byLatestClass);

  return (
    <>
      <Collapsible className="group">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle asChild className={detailsStyles.heading}>
              <h2>Courses</h2>
            </CardTitle>
            <ExpandCardTrigger count={earlierCourses.length} label="Courses" />
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {currentCourses.length ? (
              currentCourses.map((course) => (
                <CourseEntry {...course} key={course.courseCode} />
              ))
            ) : (
              <p className="text-sm text-slate-600">
                No Course is reported for this Term.
              </p>
            )}
            <CollapsibleContent className="flex flex-col gap-5">
              {earlierCourses.map((course) => (
                <CourseEntry {...course} key={course.courseCode} />
              ))}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>
      <Collapsible className="group">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle asChild className={detailsStyles.heading}>
              <h2>Classes</h2>
            </CardTitle>
            <ExpandCardTrigger count={earlierClasses.length} label="Classes" />
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {currentClasses.length ? (
              currentClasses.map((scheduleClass) => (
                <ClassEntry
                  key={classKey(scheduleClass)}
                  scheduleClass={scheduleClass}
                />
              ))
            ) : (
              <p className="text-sm text-slate-600">
                {scheduleUnavailable
                  ? "Classes are unavailable. Rankings, identity, and Community remain available."
                  : "No Class is reported for this Term."}
              </p>
            )}
            <CollapsibleContent className="flex flex-col gap-5">
              {earlierClasses.map((scheduleClass) => (
                <ClassEntry
                  key={classKey(scheduleClass)}
                  scheduleClass={scheduleClass}
                />
              ))}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>
    </>
  );
}

export function IdentityCard({
  identity,
  rankings,
}: {
  identity: InstructorIdentityLookup;
  rankings?: Rankings;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild className={detailsStyles.heading}>
          <h2>Identity History</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-semibold text-slate-600">Instructor UUID</dt>
            <dd className="break-all font-mono text-xs">
              {identity.instructor.uuid}
            </dd>
          </div>
          {identity.instructor.itsc ? (
            <div>
              <dt className="font-semibold text-slate-600">Preferred ITSC</dt>
              <dd>{identity.instructor.itsc}</dd>
            </div>
          ) : null}
        </dl>
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">Aliases and identifiers</h3>
          <ul className="flex list-none flex-col gap-2 ms-0 text-sm">
            {identity.family.flatMap((familyInstructor) =>
              familyInstructor.aliases.map((alias) => (
                <li key={`${familyInstructor.uuid}-${JSON.stringify(alias)}`}>
                  <span className="font-medium">{alias.name}</span>
                  <span className="block text-xs text-slate-500">
                    {familyInstructor.uuid === identity.instructor.uuid
                      ? "Current identity"
                      : "Retired identity"}{" "}
                    · {alias.source} · {alias.sourceCommit.slice(0, 8)}
                  </span>
                </li>
              )),
            )}
            {identity.identityHistory.identifiers.map((identifier) => (
              <li key={`${identifier.value}-${identifier.sourceCommit}`}>
                ITSC {identifier.value}
                <span className="block text-xs text-slate-500">
                  {identifier.status} · {identifier.sourceCommit.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        {identity.identityHistory.associationCorrections.length ? (
          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">Association Corrections</h3>
            <ul className="flex list-none flex-col gap-2 ms-0 text-sm">
              {identity.identityHistory.associationCorrections.map(
                (correction) => (
                  <li
                    className={
                      correction.correctionType === "split"
                        ? "break-words rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950"
                        : "break-words rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-950"
                    }
                    key={`${correction.correctionType}-${correction.sourceCommit}-${correction.targetUuid}-${correction.sourceName}-${correction.termCode ?? "all"}-${correction.courseCode}`}
                  >
                    <span className="font-medium">
                      {correction.correctionType === "split"
                        ? "Split scope needs resolution"
                        : "Calibration applied"}
                    </span>
                    <span
                      className={
                        correction.correctionType === "split"
                          ? "block text-xs text-amber-800"
                          : "block text-xs text-emerald-800"
                      }
                    >
                      {correction.sourceName} · {correction.courseCode} ·{" "}
                      {correction.termCode
                        ? rankingTermName(correction.termCode)
                        : "Every Term"}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
        ) : null}
        {rankings?.historicalEvidence.length ? (
          <section className="flex flex-col gap-3 border-t border-slate-200 pt-4">
            <h3 className="font-semibold">Retired identity evidence</h3>
            {rankings.historicalEvidence.map((historical) => (
              <div className="text-sm" key={historical.instructor.uuid}>
                <p className="font-semibold">
                  {historical.instructor.canonicalName}
                </p>
                <p className="text-xs text-slate-600">
                  Terms{" "}
                  {historical.terms
                    .map((term) => rankingTermName(term.termCode))
                    .join(" · ") || "none"}
                  ; Courses{" "}
                  {historical.courses
                    .map((course) => course.courseCode)
                    .join(" · ") || "none"}
                  . Scores remain separate across corrected identities.
                </p>
              </div>
            ))}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function InstructorDetails({
  identity,
  rankings,
  identityContent,
  rankingsContent,
  reviewComposerContent,
  classes,
  scheduleUnavailable,
  selectedTermCode,
  invalidTermCode,
  signals,
  signalsUnavailable = true,
  signedIn = false,
  signalError,
  reviews = [],
  reviewsUnavailable = true,
  reviewPublished,
  reviewWithdrawn,
  reviewError,
}: {
  identity: InstructorIdentityLookup;
  rankings?: Rankings;
  identityContent?: ReactNode;
  rankingsContent?: ReactNode;
  reviewComposerContent?: ReactNode;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
  selectedTermCode?: string;
  invalidTermCode?: string;
  signals?: SignalSummary;
  signalsUnavailable?: boolean;
  signedIn?: boolean;
  signalError?: string;
  reviews?: PublicReview[];
  reviewsUnavailable?: boolean;
  reviewPublished?: boolean;
  reviewWithdrawn?: boolean;
  reviewError?: string;
}) {
  const courses = [
    ...new Set([
      ...(rankings?.courses.map((item) => item.courseCode) ?? []),
      ...classes.map((item) => item.courseCode),
    ]),
  ].map((courseCode) => ({
    ...splitCourseCode(courseCode),
    label: courseCode,
  }));
  const contextRows: ReviewEditorOptions["contexts"] = [
    ...(rankings?.terms.map((term) => ({
      instructorUuid: identity.instructor.uuid,
      termCode: term.termCode,
      termName: rankingTermName(term.termCode),
    })) ?? []),
    ...(rankings?.courses.map((association) => ({
      course: splitCourseCode(association.courseCode),
      instructorUuid: identity.instructor.uuid,
      termCode: association.termCode,
      termName: rankingTermName(association.termCode),
    })) ?? []),
    ...classes.flatMap((item) => [
      {
        course: {
          coursePrefix: item.coursePrefix,
          courseNumber: item.courseNumber,
        },
        instructorUuid: identity.instructor.uuid,
        termCode: item.termCode,
        termName: rankingTermName(item.termCode),
      },
      {
        course: {
          coursePrefix: item.coursePrefix,
          courseNumber: item.courseNumber,
        },
        instructorUuid: identity.instructor.uuid,
        termCode: item.termCode,
        termName: rankingTermName(item.termCode),
        section: item.section,
      },
    ]),
  ];
  const contexts = [
    ...new Map(
      contextRows.map((context) => [JSON.stringify(context), context]),
    ).values(),
  ];
  const reviewEditor: ReviewEditorOptions = {
    courses,
    contexts,
    instructors: [
      {
        instructorUuid: identity.instructor.uuid,
        name: identity.instructor.canonicalName,
      },
    ],
  };
  return (
    <div className="flex w-full flex-col gap-8 text-left text-slate-900">
      <DetailsHeader
        eyebrow="Instructor"
        notice={
          invalidTermCode ? (
            <p
              className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 font-sans text-sm text-amber-950"
              role="status"
            >
              The requested Term has no ranking evidence. Showing the latest
              available Term instead.
            </p>
          ) : null
        }
        subtitle={
          identity.instructor.itsc
            ? `ITSC ${identity.instructor.itsc}`
            : undefined
        }
        termName={rankingTermName(selectedTermCode)}
        title={identity.instructor.canonicalName}
        transitionName={instructorTitleTransitionName(identity.instructor.uuid)}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section
          aria-label="Rankings and Community"
          className="flex min-w-0 flex-col gap-6"
        >
          {rankingsContent ?? (
            <DetailsRankings
              rankings={rankings}
              scoreDistribution={rankings?.scoreDistribution}
              selectedTermCode={selectedTermCode}
            />
          )}
          <DetailsCommunity
            editor={reviewEditor}
            error={reviewError}
            published={reviewPublished}
            reviewComposer={
              reviewComposerContent ?? (
                <ReviewComposer
                  {...reviewEditor}
                  displayTermNames
                  initialInstructorUuid={identity.instructor.uuid}
                  initialTermCode={selectedTermCode}
                />
              )
            }
            reviews={reviews}
            reviewsUnavailable={reviewsUnavailable}
            signedIn={signedIn}
            signalControls={
              <SignalControls
                error={signalError}
                signedIn={signedIn}
                summary={signals}
                target={{
                  type: "instructor",
                  instructorUuid: identity.instructor.uuid,
                }}
                unavailable={signalsUnavailable}
              />
            }
            withdrawn={reviewWithdrawn}
          />
        </section>
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
          <TeachingCards
            classes={classes}
            rankings={rankings}
            scheduleUnavailable={scheduleUnavailable}
            selectedTermCode={selectedTermCode}
          />
          {identityContent ?? (
            <IdentityCard identity={identity} rankings={rankings} />
          )}
        </aside>
      </div>
    </div>
  );
}
