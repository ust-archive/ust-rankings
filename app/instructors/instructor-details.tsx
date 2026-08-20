import Link from "next/link";
import { coursePath } from "@/app/courses/routes";
import type { Rankings } from "@/lib/rankings/server";
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
}: {
  selectedTermCode: string;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
}) {
  return (
    <aside className="order-1 lg:col-start-2 lg:row-start-1 lg:self-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
        <h2 className="text-lg font-bold">Instructor actions</h2>
        {classes.length ? (
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
          <p className="mt-2 text-sm text-slate-600">
            Instructor signals and Review writing will appear here when
            community contributions are available.
          </p>
        </div>
      </div>
    </aside>
  );
}

function RankingEvidence({
  rankings,
  selectedTermCode,
}: {
  rankings: Rankings;
  selectedTermCode: string;
}) {
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

function Associations({
  rankings,
  classes,
  scheduleUnavailable,
}: {
  rankings: Rankings;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
}) {
  const courseAssociations = new Map<string, Set<string>>();
  for (const association of rankings.courses) {
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
          Instructor UUID: {rankings.instructor.uuid}
        </p>
        {rankings.instructor.itsc ? (
          <p className="mt-1 text-xs text-slate-600">
            Current ITSC: {rankings.instructor.itsc}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2 text-sm">
          {rankings.instructor.aliases.map((alias) => (
            <li key={JSON.stringify(alias)}>
              <span className="font-medium">{alias.name}</span>
              <span className="text-xs text-slate-500">
                {" "}
                · {alias.source} · {alias.sourceCommit.slice(0, 8)}
              </span>
            </li>
          ))}
          {rankings.identityHistory.identifiers.map((identifier) => (
            <li key={`${identifier.value}-${identifier.sourceCommit}`}>
              ITSC {identifier.value}
              <span className="text-xs text-slate-500">
                {" "}
                · {identifier.status} · {identifier.sourceCommit.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
        {rankings.identityHistory.affectedAssociations.length ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Historical associations affected by an Instructor split need
            resolution; they have not been guessed or reassigned.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function InstructorDetails({
  rankings,
  classes,
  scheduleUnavailable,
  selectedTermCode,
}: {
  rankings: Rankings;
  classes: ScheduleClass[];
  scheduleUnavailable: boolean;
  selectedTermCode: string;
}) {
  const selectedClasses = classes.filter(
    (scheduleClass) => scheduleClass.termCode === selectedTermCode,
  );
  return (
    <div className="w-full space-y-8 text-left text-slate-900">
      <header className="border-b border-slate-200 pb-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          Instructor
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">
          {rankings.instructor.canonicalName}
        </h1>
        <p className="mt-2 text-lg text-slate-600">
          {rankings.instructor.itsc
            ? `ITSC ${rankings.instructor.itsc}`
            : `Instructor UUID ${rankings.instructor.uuid}`}
        </p>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <InstructorActions
          selectedTermCode={selectedTermCode}
          classes={selectedClasses}
          scheduleUnavailable={scheduleUnavailable}
        />
        <RankingEvidence
          rankings={rankings}
          selectedTermCode={selectedTermCode}
        />
        <CommunityArea />
        <Associations
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
