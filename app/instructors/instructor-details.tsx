import Link from "next/link";
import type { ReactNode } from "react";
import {
  ReviewComposer,
  type ReviewEditorOptions,
  Reviews,
} from "@/app/courses/course-reviews";
import { coursePath } from "@/app/courses/routes";
import { SignalControls } from "@/app/signals/signal-controls";
import type { PublicReview } from "@/lib/contributions/reviews";
import type { SignalSummary } from "@/lib/contributions/signals";
import type { InstructorIdentityLookup, Rankings } from "@/lib/rankings/server";
import { buildScheduleUrl } from "@/lib/schedule/planner";
import type { ScheduleClass } from "@/lib/schedule/server";

const criterionLabels = {
  content: "Content",
  teaching: "Teaching",
  grading: "Grading",
  workload: "Workload",
  course: "Course SFQ",
  instructor: "Instructor SFQ",
} as const;

function splitCourseCode(courseCode: string) {
  const [coursePrefix, courseNumber] = courseCode.split(" ");
  return { coursePrefix, courseNumber };
}

function scheduleUrl(termCode: string, classes: ScheduleClass[]) {
  return buildScheduleUrl({
    termCode,
    classNumbers: classes.map((item) => item.classNumber),
    view: "cart",
  });
}

function InstructorActions({
  selectedTermCode,
  classes,
  scheduleUnavailable,
  instructorUuid,
  signals,
  signalsUnavailable,
  signedIn,
  signalUpdated,
  signalError,
  reviewComposer,
}: {
  selectedTermCode?: string;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
  instructorUuid: string;
  signals?: SignalSummary;
  signalsUnavailable: boolean;
  signedIn: boolean;
  signalUpdated?: boolean;
  signalError?: string;
  reviewComposer: ReactNode;
}) {
  return (
    <aside className="order-1 lg:col-start-2 lg:row-start-1 lg:self-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
        <h2 className="text-lg font-bold">Instructor actions</h2>
        {classes.length && selectedTermCode ? (
          <Link
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#003366] px-4 py-3 font-bold text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
            href={scheduleUrl(selectedTermCode, classes)}
          >
            Open in Schedule
          </Link>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            {scheduleUnavailable
              ? "Schedule actions are unavailable while Schedule data cannot be read."
              : "No Classes are available for this Instructor in the selected Term."}
          </p>
        )}
        <div className="mt-5 border-t border-slate-200 pt-4">
          <p className="font-semibold">Contribution controls</p>
          <SignalControls
            error={signalError}
            signedIn={signedIn}
            summary={signals}
            target={{ type: "instructor", instructorUuid }}
            unavailable={signalsUnavailable}
            updated={signalUpdated}
          />
          <p className="mt-5 border-t border-slate-200 pt-4 text-sm text-slate-600">
            Publish one active attributed Review for each exact Review Basis and
            Review Context tuple.
          </p>
          {reviewComposer}
        </div>
      </div>
    </aside>
  );
}

function RankingEvidence({
  rankings,
  selectedTermCode,
}: {
  rankings?: Rankings;
  selectedTermCode?: string;
}) {
  if (!rankings)
    return (
      <section className="order-2 min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
        <h2 className="text-2xl font-bold">Ranking evidence and trends</h2>
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="status"
        >
          Ranking evidence is unavailable. Instructor identity, Schedule, and
          community sections remain available.
        </p>
      </section>
    );
  const evidence = rankings.terms.find(
    (term) => term.termCode === selectedTermCode,
  );
  const ranking =
    rankings.population.termCode === selectedTermCode
      ? rankings.ranking
      : undefined;
  return (
    <section className="order-2 min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
      <div>
        <h2 className="text-2xl font-bold">Ranking evidence and trends</h2>
        <p className="mt-1 text-sm text-slate-600">
          Selected-Term evidence for {selectedTermCode}.
        </p>
      </div>
      {!evidence ? (
        <p className="rounded-xl border bg-slate-50 p-4" role="status">
          This Instructor has no ranking evidence for the selected Term.
        </p>
      ) : (
        <>
          {ranking ? (
            <div className="rounded-2xl bg-slate-900 p-5 text-white">
              <p className="text-sm text-slate-300">Learning-focused</p>
              <p className="mt-1 text-xl font-bold">
                Global Rank {ranking.globalRank} of {ranking.globalPopulation}
              </p>
              <p className="mt-1 text-sm">Score {ranking.score.toFixed(4)}</p>
            </div>
          ) : (
            <p className="rounded-xl border bg-slate-50 p-4" role="status">
              Evidence is available, but this Instructor is unranked under the
              required scoring criteria or activity mode.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(evidence.criteria).map(([criterion, value]) => (
              <div
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                key={criterion}
              >
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {criterionLabels[criterion as keyof typeof criterionLabels]}
                </dt>
                <dd className="mt-1 text-2xl font-bold">
                  {value?.bayesian.toFixed(2)}
                </dd>
                <dd className="text-xs text-slate-500">
                  {value?.samples} sample{value?.samples === 1 ? "" : "s"}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {rankings.terms.length > 1 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="p-4 text-left font-bold">
              Historical criterion evidence by Term
            </caption>
            <thead>
              <tr className="border-t border-slate-200 bg-slate-50 text-left">
                <th className="px-3 py-2" scope="col">
                  Term
                </th>
                {Object.entries(criterionLabels).map(([criterion, label]) => (
                  <th className="px-3 py-2" key={criterion} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rankings.terms.map((term) => (
                <tr className="border-t border-slate-200" key={term.termCode}>
                  <th className="px-3 py-2" scope="row">
                    {term.termCode}
                    {term.termCode === selectedTermCode ? " (selected)" : ""}
                  </th>
                  {Object.keys(criterionLabels).map((criterion) => (
                    <td className="px-3 py-2 tabular-nums" key={criterion}>
                      {term.criteria[
                        criterion as keyof typeof criterionLabels
                      ]?.bayesian.toFixed(2) ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function CommunityArea({
  reviews,
  unavailable,
  published,
  withdrawn,
  error,
  editor,
}: {
  reviews: PublicReview[];
  unavailable: boolean;
  published?: boolean;
  withdrawn?: boolean;
  error?: string;
  editor?: ReviewEditorOptions;
}) {
  return (
    <section
      className="order-3 rounded-2xl border border-slate-200 bg-slate-50 p-6 lg:col-start-1 lg:row-start-2"
      id="reviews"
    >
      <h2 className="text-2xl font-bold">Community Reviews</h2>
      <p className="mt-2 text-slate-600">
        Published experiences with this Instructor Basis.
      </p>
      {published ? (
        <p
          className="mt-4 rounded-lg bg-green-50 p-3 text-green-900"
          role="status"
        >
          Review Revision published.
        </p>
      ) : null}
      {withdrawn ? (
        <p
          className="mt-4 rounded-lg bg-green-50 p-3 text-green-900"
          role="status"
        >
          Review withdrawn from public display.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-900" role="alert">
          Review could not be published ({error}).
        </p>
      ) : null}
      {unavailable ? (
        <p
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="status"
        >
          Community Reviews are unavailable. This does not represent zero
          Reviews.
        </p>
      ) : (
        <Reviews editor={editor} reviews={reviews} />
      )}
    </section>
  );
}

function Associations({
  identity,
  rankings,
  classes,
  scheduleUnavailable,
}: {
  identity: InstructorIdentityLookup;
  rankings?: Rankings;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
}) {
  const courseAssociations = new Map<string, Set<string>>();
  for (const association of [
    ...(rankings?.courses ?? []),
    ...classes.map((scheduleClass) => ({
      courseCode: scheduleClass.courseCode,
      termCode: scheduleClass.termCode,
    })),
  ]) {
    const terms = courseAssociations.get(association.courseCode) ?? new Set();
    terms.add(association.termCode);
    courseAssociations.set(association.courseCode, terms);
  }
  return (
    <section className="order-4 space-y-6 rounded-2xl border bg-white p-5 shadow-sm lg:col-start-2 lg:row-start-2">
      <div>
        <h2 className="text-xl font-bold">Associated Courses and Classes</h2>
        {courseAssociations.size ? (
          <ul className="mt-3 space-y-3">
            {[...courseAssociations].map(([courseCode, terms]) => {
              const { coursePrefix, courseNumber } =
                splitCourseCode(courseCode);
              return (
                <li key={courseCode}>
                  <Link
                    className="font-bold"
                    href={coursePath(coursePrefix, courseNumber)}
                  >
                    {courseCode}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {" "}
                    · {[...terms].join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            No Course association is recorded.
          </p>
        )}
        {classes.length ? (
          <ul className="mt-4 space-y-2 border-t pt-4">
            {classes.map((scheduleClass) => (
              <li
                key={`${scheduleClass.termCode}-${scheduleClass.classNumber}`}
              >
                <Link
                  className="font-semibold"
                  href={coursePath(
                    scheduleClass.coursePrefix,
                    scheduleClass.courseNumber,
                    scheduleClass.termCode,
                    scheduleClass.section,
                  )}
                >
                  {scheduleClass.courseCode} · {scheduleClass.section} · Class{" "}
                  {scheduleClass.classNumber}
                </Link>
                <span className="text-xs text-slate-500">
                  {" "}
                  · {scheduleClass.termCode}
                </span>
              </li>
            ))}
          </ul>
        ) : scheduleUnavailable ? (
          <p className="mt-3 text-sm text-amber-900">
            Classes are unavailable.
          </p>
        ) : null}
      </div>
      <div>
        <h2 className="text-xl font-bold">
          Instructor aliases and identity history
        </h2>
        <p className="mt-2 break-all text-xs text-slate-600">
          Instructor UUID: {identity.instructor.uuid}
        </p>
        {identity.instructor.itsc ? (
          <p className="mt-1 text-xs text-slate-600">
            Current ITSC: {identity.instructor.itsc}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2 text-sm">
          {identity.family.flatMap((familyInstructor) =>
            familyInstructor.aliases.map((alias) => (
              <li key={`${familyInstructor.uuid}-${JSON.stringify(alias)}`}>
                <span className="font-medium">{alias.name}</span>
                <span className="text-xs text-slate-500">
                  {" "}
                  ·{" "}
                  {familyInstructor.uuid === identity.instructor.uuid
                    ? "current"
                    : "retired"}
                  {" · "}
                  {alias.source} · {alias.sourceCommit.slice(0, 8)}
                </span>
              </li>
            )),
          )}
          {identity.identityHistory.identifiers.map((identifier) => (
            <li key={`${identifier.value}-${identifier.sourceCommit}`}>
              ITSC {identifier.value}
              <span className="text-xs text-slate-500">
                {" "}
                · {identifier.status} · {identifier.sourceCommit.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
        {identity.identityHistory.affectedAssociations.length ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Historical associations affected by an Instructor split need
            resolution; they have not been guessed or reassigned.
          </p>
        ) : null}
        {rankings?.historicalEvidence.length ? (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="font-bold">Retired identity evidence</h3>
            <ul className="mt-2 space-y-3 text-sm">
              {rankings.historicalEvidence.map((historical) => (
                <li key={historical.instructor.uuid}>
                  <span className="font-semibold">
                    {historical.instructor.canonicalName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Evidence retained separately for Terms{" "}
                    {historical.terms.map((term) => term.termCode).join(", ") ||
                      "none"}
                    ; Courses{" "}
                    {historical.courses
                      .map((course) => course.courseCode)
                      .join(", ") || "none"}
                    . Scores are not combined across corrected identities.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function letterGrade(percentile: number) {
  return (
    [
      [0.9, "A+"],
      [0.8, "A"],
      [0.75, "A−"],
      [0.6, "B+"],
      [0.45, "B"],
      [0.35, "B−"],
      [0.3, "C+"],
      [0.25, "C"],
      [0.2, "C−"],
      [0.1, "D"],
      [0, "F"],
    ] as const
  ).find(([threshold]) => percentile >= threshold)?.[1];
}

export function InstructorDetails({
  identity,
  rankings,
  classes,
  scheduleUnavailable,
  selectedTermCode,
  invalidTermCode,
  signals,
  signalsUnavailable = true,
  signedIn = false,
  signalUpdated,
  signalError,
  reviews = [],
  reviewsUnavailable = true,
  reviewPublished,
  reviewWithdrawn,
  reviewError,
}: {
  identity: InstructorIdentityLookup;
  rankings?: Rankings;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
  selectedTermCode?: string;
  invalidTermCode?: string;
  signals?: SignalSummary;
  signalsUnavailable?: boolean;
  signedIn?: boolean;
  signalUpdated?: boolean;
  signalError?: string;
  reviews?: PublicReview[];
  reviewsUnavailable?: boolean;
  reviewPublished?: boolean;
  reviewWithdrawn?: boolean;
  reviewError?: string;
}) {
  const selectedClasses = selectedTermCode
    ? classes.filter(
        (scheduleClass) => scheduleClass.termCode === selectedTermCode,
      )
    : [];
  const grade = rankings?.ranking
    ? letterGrade(rankings.ranking.globalPercentile)
    : undefined;
  const courses = [
    ...new Set([
      ...(rankings?.courses.map((item) => item.courseCode) ?? []),
      ...classes.map((item) => item.courseCode),
    ]),
  ].map((courseCode) => ({
    ...splitCourseCode(courseCode),
    label: courseCode,
  }));
  const contexts = [
    ...(rankings?.terms.map((term) => ({
      instructorUuid: identity.instructor.uuid,
      termCode: term.termCode,
    })) ?? []),
    ...classes.flatMap((item) => [
      {
        course: {
          coursePrefix: item.coursePrefix,
          courseNumber: item.courseNumber,
        },
        instructorUuid: identity.instructor.uuid,
        termCode: item.termCode,
      },
      {
        course: {
          coursePrefix: item.coursePrefix,
          courseNumber: item.courseNumber,
        },
        instructorUuid: identity.instructor.uuid,
        termCode: item.termCode,
        section: item.section,
      },
    ]),
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
    <div className="w-full space-y-8 text-left text-slate-900">
      <header className="border-b border-slate-200 pb-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          Instructor
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">
          {identity.instructor.canonicalName}
        </h1>
        <p className="mt-2 text-lg text-slate-600">
          {identity.instructor.itsc
            ? `ITSC ${identity.instructor.itsc}`
            : `Instructor UUID ${identity.instructor.uuid}`}
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Ranking Preset
            </dt>
            <dd className="font-semibold">
              {rankings
                ? `${rankings.configuration.preset === "grade" ? "Grade" : "Learning"}-focused Ranking Preset`
                : "Ranking Preset unavailable"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Ranking Population
            </dt>
            <dd className="font-semibold">
              {rankings
                ? `${rankings.population.size} eligible Instructors`
                : "Ranking Population unavailable"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Grade summary
            </dt>
            <dd className="font-semibold">
              {grade
                ? `Grade ${grade}`
                : rankings
                  ? "Unranked"
                  : "Grade unavailable"}
            </dd>
          </div>
        </dl>
        {invalidTermCode ? (
          <p
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="status"
          >
            Term {invalidTermCode} has no ranking evidence. Showing the latest
            available Term instead.
          </p>
        ) : null}
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <InstructorActions
          selectedTermCode={selectedTermCode}
          classes={selectedClasses}
          scheduleUnavailable={scheduleUnavailable}
          instructorUuid={identity.instructor.uuid}
          signals={signals}
          signalsUnavailable={signalsUnavailable}
          signedIn={signedIn}
          signalUpdated={signalUpdated}
          signalError={signalError}
          reviewComposer={
            <ReviewComposer
              {...reviewEditor}
              initialInstructorUuid={identity.instructor.uuid}
            />
          }
        />
        <RankingEvidence
          rankings={rankings}
          selectedTermCode={selectedTermCode}
        />
        <CommunityArea
          editor={reviewEditor}
          error={reviewError}
          published={reviewPublished}
          withdrawn={reviewWithdrawn}
          reviews={reviews}
          unavailable={reviewsUnavailable}
        />
        <Associations
          identity={identity}
          rankings={rankings}
          classes={classes}
          scheduleUnavailable={scheduleUnavailable}
        />
      </div>
    </div>
  );
}

export function InstructorDetailLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="w-full space-y-8 text-left"
    >
      <header className="border-b border-slate-200 pb-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          Instructor
        </p>
        <h1 className="mt-2 text-3xl font-bold">Loading Instructor details…</h1>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-56 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />
        <div className="h-40 rounded-2xl bg-slate-100 motion-safe:animate-pulse lg:col-start-2 lg:row-start-1" />
      </div>
    </div>
  );
}
