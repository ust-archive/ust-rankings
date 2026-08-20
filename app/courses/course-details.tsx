import Link from "next/link";
import type { ReactNode } from "react";
import { instructorPath } from "@/app/instructors/routes";
import type { CourseRankings } from "@/lib/rankings/server";
import { buildScheduleUrl } from "@/lib/schedule/planner";
import type {
  CourseOffering,
  ScheduleClass,
  ScheduleDetails,
  ScheduleMeeting,
} from "@/lib/schedule/server";
import { coursePath } from "./routes";

const criterionLabels = {
  content: "Content",
  teaching: "Teaching",
  grading: "Grading",
  workload: "Workload",
  course: "Course SFQ",
  instructor: "Instructor SFQ",
} as const;

function scheduleUrl(termCode: string, classes: ScheduleClass[]) {
  return buildScheduleUrl({
    termCode,
    classNumbers: classes.map((item) => item.classNumber),
    view: "cart",
  });
}

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
        const key = instructor.uuid ?? instructor.sourceName;
        const current = instructors.get(key) ?? {
          name: instructor.sourceName,
          uuid: instructor.uuid,
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

function ActionArea({
  type,
  scheduleHref,
  instructorNames,
}: {
  type: "Course" | "Course Offering" | "Class";
  scheduleHref?: string;
  instructorNames: string[];
}) {
  return (
    <aside className="order-1 space-y-4 lg:col-start-2 lg:row-start-1 lg:self-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
        <h2 className="text-lg font-bold">{type} actions</h2>
        {scheduleHref ? (
          <Link
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#003366] px-4 py-3 font-bold text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
            href={scheduleHref}
          >
            Open in Schedule
          </Link>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Schedule actions are unavailable while Schedule data cannot be read.
          </p>
        )}
        <div className="mt-5 border-t border-slate-200 pt-4">
          <p className="font-semibold">Contribution controls</p>
          {type === "Class" ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                This Class is Review Context, not a signal target. Eligible
                controls belong to its Bases.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5">
                  Course Basis
                </span>
                {instructorNames.map((name) => (
                  <span
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5"
                    key={name}
                  >
                    Instructor Basis · {name}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              Course signals and Review writing will appear here when community
              contributions are available.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function RankingEvidence({
  rankings,
  termCode,
}: {
  rankings?: CourseRankings;
  termCode?: string;
}) {
  const evidence = rankings?.terms.find((term) => term.termCode === termCode);
  const ranking =
    rankings && rankings.population.termCode === termCode
      ? rankings.ranking
      : undefined;
  return (
    <section className="order-2 min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
      <div>
        <h2 className="text-2xl font-bold">Ranking evidence and trends</h2>
        <p className="mt-1 text-sm text-slate-600">
          {termCode
            ? `Selected-Term evidence for ${termCode}.`
            : "Select a Course Offering to inspect Term evidence."}
        </p>
      </div>
      {!rankings ? (
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="status"
        >
          Course rankings are unavailable. Schedule and Course identity remain
          available.
        </p>
      ) : !evidence ? (
        <p className="rounded-xl border bg-slate-50 p-4" role="status">
          This Course Offering has no ranking evidence in the accepted ranking
          generation.
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
              Evidence is available for this Term, but the Course is unranked
              under the required scoring criteria.
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
                    {Object.entries(criterionLabels).map(
                      ([criterion, label]) => (
                        <th className="px-3 py-2" key={criterion} scope="col">
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rankings.terms.map((term) => (
                    <tr
                      className="border-t border-slate-200"
                      key={term.termCode}
                    >
                      <th className="px-3 py-2" scope="row">
                        {term.termCode}
                        {term.termCode === termCode ? " (selected)" : ""}
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
        </>
      )}
    </section>
  );
}

function CommunityArea() {
  return (
    <section className="order-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 lg:col-start-1 lg:row-start-2">
      <h2 className="text-2xl font-bold">Community Reviews</h2>
      <p className="mt-2 text-slate-600">
        Community contributions are not available yet. This reserved area is
        separate from ranking and Schedule availability and does not represent
        zero Reviews.
      </p>
    </section>
  );
}

function DetailShell({
  eyebrow,
  title,
  subtitle,
  action,
  evidence,
  associations,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action: ReactNode;
  evidence: ReactNode;
  associations: ReactNode;
}) {
  return (
    <div className="w-full space-y-8 text-left text-slate-900">
      <header className="border-b border-slate-200 pb-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">
          {title}
        </h1>
        <p className="mt-2 text-lg text-slate-600">{subtitle}</p>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {action}
        {evidence}
        <CommunityArea />
        <section className="order-4 lg:col-start-2 lg:row-start-2">
          {associations}
        </section>
      </div>
    </div>
  );
}

function ClassLinks({ offering }: { offering: CourseOffering }) {
  return (
    <ul className="mt-3 space-y-2">
      {offering.classes.map((scheduleClass) => (
        <li key={scheduleClass.classNumber}>
          <Link
            className="font-semibold"
            href={coursePath(
              offering.coursePrefix,
              offering.courseNumber,
              offering.termCode,
              scheduleClass.section,
            )}
          >
            {scheduleClass.section} · Class {scheduleClass.classNumber}
          </Link>{" "}
          <span className="text-sm text-slate-600">
            · {scheduleClass.enrollment}/{scheduleClass.capacity} enrolled
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DetailLoading({
  entity,
}: {
  entity: "Course" | "Course Offering" | "Class";
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="w-full space-y-8 text-left"
    >
      <header className="border-b border-slate-200 pb-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          {entity}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Loading {entity} details…</h1>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-56 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />
        <div className="h-40 rounded-2xl bg-slate-100 motion-safe:animate-pulse lg:col-start-2 lg:row-start-1" />
      </div>
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
}: {
  coursePrefix: string;
  courseNumber: string;
  schedule?: Extract<ScheduleDetails, { type: "course" }>;
  rankings?: CourseRankings;
  selectedTermCode?: string;
}) {
  const offerings = schedule?.offerings ?? [];
  const selected = selectedTermCode
    ? offerings.find((offering) => offering.termCode === selectedTermCode)
    : offerings.at(-1);
  const scheduleSelection = selected ?? offerings.at(-1);
  const evidenceTermCode =
    selectedTermCode ??
    scheduleSelection?.termCode ??
    rankings?.population.termCode;
  const title =
    scheduleSelection?.title ??
    rankings?.course.title ??
    "Catalog details unavailable";
  const instructors = uniqueInstructors(offerings, rankings);
  return (
    <DetailShell
      eyebrow="Course"
      title={`${coursePrefix} ${courseNumber}`}
      subtitle={title}
      action={
        <ActionArea
          type="Course"
          scheduleHref={
            scheduleSelection
              ? scheduleUrl(
                  scheduleSelection.termCode,
                  scheduleSelection.classes,
                )
              : undefined
          }
          instructorNames={instructors
            .filter((item) => item.uuid)
            .map((item) => item.name)}
        />
      }
      evidence={
        <RankingEvidence rankings={rankings} termCode={evidenceTermCode} />
      }
      associations={
        <div className="space-y-6 rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-xl font-bold">Course Offerings and Classes</h2>
            {offerings.length ? (
              <ul className="mt-3 space-y-4">
                {[...offerings].reverse().map((offering) => (
                  <li key={offering.termCode}>
                    <Link
                      className="font-bold"
                      href={coursePath(
                        offering.coursePrefix,
                        offering.courseNumber,
                        offering.termCode,
                      )}
                    >
                      {offering.termName}
                    </Link>
                    <ClassLinks offering={offering} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-amber-900">
                Course Offerings are unavailable.
              </p>
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold">Associated Instructors</h2>
            {instructors.length ? (
              <ul className="mt-3 space-y-2">
                {instructors.map((instructor) => (
                  <li key={instructor.uuid ?? instructor.name}>
                    {instructor.uuid ? (
                      <Link
                        className="font-semibold"
                        href={instructorPath({
                          uuid: instructor.uuid,
                          itsc: instructor.itsc,
                        })}
                      >
                        {instructor.name}
                      </Link>
                    ) : (
                      instructor.name
                    )}{" "}
                    <span className="text-xs text-slate-500">
                      ·{" "}
                      {instructor.uuid
                        ? "resolved Instructor"
                        : "unresolved source name"}{" "}
                      · {instructor.termCodes.size} Term
                      {instructor.termCodes.size === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                No resolved Instructor association is available.
              </p>
            )}
          </div>
        </div>
      }
    />
  );
}

export function CourseOfferingDetails({
  offering,
  rankings,
}: {
  offering: Extract<ScheduleDetails, { type: "course-offering" }>;
  rankings?: CourseRankings;
}) {
  const instructors = uniqueInstructors([offering], rankings).filter((item) =>
    item.termCodes.has(offering.termCode),
  );
  return (
    <DetailShell
      eyebrow="Course Offering"
      title={offering.courseCode}
      subtitle={`${offering.termName} · ${offering.title}`}
      action={
        <ActionArea
          type="Course Offering"
          scheduleHref={scheduleUrl(offering.termCode, offering.classes)}
          instructorNames={instructors
            .filter((item) => item.uuid)
            .map((item) => item.name)}
        />
      }
      evidence={
        <RankingEvidence rankings={rankings} termCode={offering.termCode} />
      }
      associations={
        <div className="space-y-5 rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-xl font-bold">Offering catalog details</h2>
            <p className="mt-2 text-sm text-slate-700">
              {offering.description || "No description is published."}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {offering.credits} credits · {offering.career}
            </p>
          </div>
          <div>
            <h2 className="text-xl font-bold">Classes</h2>
            <ClassLinks offering={offering} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Associated Instructors</h2>
            {instructors.length ? (
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {instructors.map((item) => (
                  <li key={item.uuid ?? item.name}>
                    {item.uuid ? (
                      <Link
                        className="font-semibold"
                        href={instructorPath({
                          uuid: item.uuid,
                          itsc: item.itsc,
                        })}
                      >
                        {item.name}
                      </Link>
                    ) : (
                      `${item.name} (unresolved source name)`
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-700">
                No Instructor association is available.
              </p>
            )}
          </div>
        </div>
      }
    />
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
}: {
  scheduleClass: Extract<ScheduleDetails, { type: "class" }>;
  rankings?: CourseRankings;
}) {
  const instructors = new Map<string, { name: string; uuid?: string }>();
  for (const meeting of scheduleClass.meetings)
    for (const instructor of meeting.instructors)
      instructors.set(instructor.uuid ?? instructor.sourceName, {
        name: instructor.sourceName,
        uuid: instructor.uuid,
      });
  return (
    <DetailShell
      eyebrow="Class"
      title={`${scheduleClass.courseCode} · ${scheduleClass.section}`}
      subtitle={`${scheduleClass.courseTitle} · Term ${scheduleClass.termCode}`}
      action={
        <ActionArea
          type="Class"
          scheduleHref={scheduleUrl(scheduleClass.termCode, [scheduleClass])}
          instructorNames={[...instructors.values()]
            .filter((instructor) => instructor.uuid)
            .map((instructor) => instructor.name)}
        />
      }
      evidence={
        <section className="order-2 min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <div>
            <h2 className="text-2xl font-bold">Class schedule and quota</h2>
            <p className="mt-2 font-semibold">
              Class Number {scheduleClass.classNumber}
            </p>
            <p className="mt-1 text-slate-700">
              {scheduleClass.enrollment} / {scheduleClass.capacity} enrolled ·{" "}
              {scheduleClass.waitlist} waiting ·{" "}
              {scheduleClass.open ? "Open" : "Closed"}
            </p>
          </div>
          <ul className="space-y-3">
            {scheduleClass.meetings.length ? (
              scheduleClass.meetings.map((meeting) => (
                <li
                  className="rounded-xl border bg-white p-4 shadow-sm"
                  key={JSON.stringify(meeting)}
                >
                  <p className="font-semibold">{meetingLabel(meeting)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {meeting.dateFrom ?? "Dates TBA"}
                    {meeting.dateTo ? `–${meeting.dateTo}` : ""}
                  </p>
                </li>
              ))
            ) : (
              <li className="rounded-xl border bg-slate-50 p-4">Meeting TBA</li>
            )}
          </ul>
          <RankingEvidence
            rankings={rankings}
            termCode={scheduleClass.termCode}
          />
        </section>
      }
      associations={
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Class associations</h2>
          <p className="mt-2 text-sm text-slate-600">
            Course Basis · {scheduleClass.courseCode}
          </p>
          <div className="mt-2 text-sm text-slate-600">
            Instructor Basis ·{" "}
            {[...instructors.values()].length ? (
              [...instructors.values()].map((instructor, index) => (
                <span key={instructor.uuid ?? instructor.name}>
                  {index > 0 ? " · " : ""}
                  {instructor.uuid ? (
                    <Link
                      className="font-semibold"
                      href={instructorPath(instructor.uuid)}
                    >
                      {instructor.name}
                    </Link>
                  ) : (
                    `${instructor.name} (unresolved source name)`
                  )}
                </span>
              ))
            ) : (
              <span>No Instructor association</span>
            )}
          </div>
          {scheduleClass.reservations.length ? (
            <ul className="mt-4 space-y-2">
              {scheduleClass.reservations.map((reservation) => (
                <li key={reservation.name}>
                  {reservation.name}: {reservation.enrollment}/
                  {reservation.quota}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      }
    />
  );
}
