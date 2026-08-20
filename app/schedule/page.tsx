import { Search } from "lucide-react";
import Link from "next/link";
import { coursePath } from "@/app/courses/routes";
import { instructorPath } from "@/app/instructors/routes";
import { CalendarActions } from "@/app/schedule/calendar-actions";
import { CanonicalScheduleUrl } from "@/app/schedule/canonical-schedule-url";
import { SisParserDialog } from "@/app/schedule/sis-parser-dialog";
import { NewReleaseBanner } from "@/components/component/new-release-banner";
import { PathAdvisor } from "@/data/cq/path-advisor";
import {
  buildCalendarUrl,
  buildScheduleUrl,
  findPlannerConflicts,
  MAX_PLANNER_CLASSES,
  type PlannerState,
  parsePlannerQuery,
} from "@/lib/schedule/planner";
import {
  InvalidScheduleQueryError,
  querySchedule,
  resolveClasses,
  type ScheduleClass,
  type ScheduleMeeting,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

type SearchParams = Record<string, string | string[] | undefined>;

function meetingTime(meeting: ScheduleMeeting) {
  return meeting.timeFrom && meeting.timeTo
    ? `${meeting.timeFrom}–${meeting.timeTo}`
    : "Time TBA";
}

function meetingDates(meeting: ScheduleMeeting) {
  if (meeting.dateFrom && meeting.dateTo)
    return `${meeting.dateFrom}–${meeting.dateTo}`;
  return meeting.dateFrom ?? meeting.dateTo ?? "Dates TBA";
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <section
      className="w-[calc(100vw-2rem)] max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-left text-amber-950"
      role="alert"
    >
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2">{message}</p>
    </section>
  );
}

function selectedUrl(
  state: PlannerState,
  classNumber: number,
  selected: boolean,
) {
  return buildScheduleUrl({
    ...state,
    classNumbers: selected
      ? state.classNumbers.filter((number) => number !== classNumber)
      : [...state.classNumbers, classNumber],
  });
}

function PlannerAction({
  scheduleClass,
  state,
}: {
  scheduleClass: ScheduleClass;
  state: PlannerState;
}) {
  const selected = state.classNumbers.includes(scheduleClass.classNumber);
  if (!selected && state.classNumbers.length >= MAX_PLANNER_CLASSES)
    return (
      <button
        aria-label={`Cannot add Class ${scheduleClass.classNumber}; planner cart is full`}
        className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-500"
        disabled
        type="button"
      >
        Limit reached
      </button>
    );
  return (
    <Link
      aria-label={`${selected ? "Remove" : "Add"} Class ${scheduleClass.classNumber}${selected ? " from" : " to"} planner cart`}
      className="inline-flex min-h-10 items-center rounded-lg border border-[#003366] px-3 py-2 font-semibold text-[#003366] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
      href={selectedUrl(state, scheduleClass.classNumber, selected)}
    >
      {selected ? "Remove" : "Add"}
    </Link>
  );
}

function ClassSummary({
  scheduleClass,
  state,
}: {
  scheduleClass: ScheduleClass;
  state: PlannerState;
}) {
  return (
    <article className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-bold">
            <Link
              href={coursePath(
                scheduleClass.coursePrefix,
                scheduleClass.courseNumber,
                scheduleClass.termCode,
              )}
            >
              {scheduleClass.courseCode} · {scheduleClass.courseTitle}
            </Link>
          </p>
          <p className="mt-1 font-semibold">
            <span className="sr-only">Class details: </span>
            <Link
              href={coursePath(
                scheduleClass.coursePrefix,
                scheduleClass.courseNumber,
                scheduleClass.termCode,
                scheduleClass.section,
              )}
            >
              {scheduleClass.section} · {scheduleClass.classNumber}
            </Link>
          </p>
        </div>
        <PlannerAction scheduleClass={scheduleClass} state={state} />
      </div>
      <ul className="mt-4 space-y-2 text-sm text-slate-700">
        {scheduleClass.meetings.length > 0 ? (
          scheduleClass.meetings.map((meeting) => (
            <li key={JSON.stringify(meeting)}>
              {meeting.weekday} {meetingTime(meeting)} ·{" "}
              {meeting.room || "Room TBA"}
            </li>
          ))
        ) : (
          <li>Meeting TBA</li>
        )}
      </ul>
    </article>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const plannerQuery = parsePlannerQuery(await searchParams);
  const messages = [...plannerQuery.messages];
  let page: Awaited<ReturnType<typeof querySchedule>>;
  let unknownTerm = plannerQuery.termInvalid;

  try {
    page = await querySchedule({
      termCode: plannerQuery.termCode,
      search: plannerQuery.search,
    });
  } catch (error) {
    if (error instanceof InvalidScheduleQueryError && plannerQuery.termCode) {
      unknownTerm = true;
      messages.push("Unknown Term Code; showing the latest Term.");
      try {
        page = await querySchedule({ search: plannerQuery.search });
      } catch (fallbackError) {
        return (
          <ErrorState
            title="UST Schedule is unavailable"
            message={
              fallbackError instanceof ScheduleUnavailableError
                ? "The validated Schedule generation could not be loaded. Rankings and other public pages remain available."
                : "Schedule data could not be read right now."
            }
          />
        );
      }
    } else {
      return (
        <ErrorState
          title="UST Schedule is unavailable"
          message={
            error instanceof ScheduleUnavailableError
              ? "The validated Schedule generation could not be loaded. Rankings and other public pages remain available."
              : "Schedule data could not be read right now."
          }
        />
      );
    }
  }

  let selectedClasses: ScheduleClass[] = [];
  if (plannerQuery.classNumbers.length > 0 && !unknownTerm) {
    try {
      selectedClasses = await resolveClasses(
        page.term.termCode,
        plannerQuery.classNumbers,
      );
    } catch (error) {
      if (error instanceof InvalidScheduleQueryError)
        messages.push(
          "Selected Class Numbers are not available in this Term; the planner cart was reset.",
        );
      else
        return (
          <ErrorState
            title="UST Schedule is unavailable"
            message="Selected Classes could not be read right now."
          />
        );
    }
  } else if (plannerQuery.classNumbers.length > 0) {
    messages.push(
      "Selected Class Numbers are not available in this Term; the planner cart was reset.",
    );
  }

  const state: PlannerState = {
    termCode: page.term.termCode,
    search: page.search,
    classNumbers: selectedClasses.map((item) => item.classNumber),
    view: plannerQuery.view,
  };
  const conflicts = findPlannerConflicts(selectedClasses);

  return (
    <>
      <CanonicalScheduleUrl url={buildScheduleUrl(state)} />
      <NewReleaseBanner className="-mt-12" />
      <header className="w-[calc(100vw-2rem)] max-w-5xl text-left">
        <h1 className="text-logo-gradient text-6xl font-bold tracking-tighter sm:text-7xl">
          UST Schedule
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Browse Course Offerings and select Classes in a public planner URL you
          can reload or share without signing in.
        </p>
      </header>

      {messages.length > 0 ? (
        <section
          className="w-[calc(100vw-2rem)] max-w-5xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-amber-950"
          role="alert"
        >
          <h2 className="font-bold">Some Schedule values were not used</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {[...new Set(messages)].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid w-[calc(100vw-2rem)] max-w-5xl gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm lg:grid-cols-[minmax(12rem,16rem)_1fr]">
        <form action="/schedule" className="grid content-end gap-2">
          {state.search ? (
            <input name="q" type="hidden" value={state.search} />
          ) : null}
          <input name="view" type="hidden" value={state.view} />
          <label className="grid gap-1 text-sm font-semibold" htmlFor="term">
            Term
            <select
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 font-normal"
              defaultValue={state.termCode}
              id="term"
              name="term"
            >
              {page.terms.map((term) => (
                <option key={term.termCode} value={term.termCode}>
                  {term.termName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="h-10 rounded-lg border border-slate-300 px-3 font-semibold hover:bg-slate-50"
            type="submit"
          >
            Change Term
          </button>
          <p className="text-xs text-slate-600">
            Changing Term clears selected Classes so a reused Class Number
            cannot select a different Class.
          </p>
        </form>
        <form
          action="/schedule"
          className="grid content-end gap-2 sm:grid-cols-[1fr_auto]"
        >
          <input name="term" type="hidden" value={state.termCode} />
          <input name="view" type="hidden" value={state.view} />
          {state.classNumbers.map((classNumber) => (
            <input
              key={classNumber}
              name="class"
              type="hidden"
              value={classNumber}
            />
          ))}
          <label className="grid gap-1 text-sm font-semibold" htmlFor="q">
            Search Schedule
            <input
              className="h-11 rounded-lg border border-slate-300 px-4 font-normal"
              defaultValue={state.search ?? ""}
              id="q"
              maxLength={100}
              name="q"
              placeholder="Course, Instructor, room, Section, Class Number"
              type="search"
            />
          </label>
          <button
            className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#003366] px-5 font-semibold text-white hover:bg-[#174f82] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003366]"
            type="submit"
          >
            <Search aria-hidden="true" className="h-4 w-4" /> Search
          </button>
        </form>
      </section>

      <section className="w-[calc(100vw-2rem)] max-w-5xl space-y-4 text-left">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Schedule views"
            className="flex rounded-lg bg-slate-100 p-1"
          >
            <Link
              aria-current={state.view === "browse" ? "page" : undefined}
              className="rounded-md px-4 py-2 font-semibold aria-[current=page]:bg-white aria-[current=page]:shadow-sm"
              href={buildScheduleUrl({ ...state, view: "browse" })}
            >
              Browse Classes
            </Link>
            <Link
              aria-current={state.view === "cart" ? "page" : undefined}
              className="rounded-md px-4 py-2 font-semibold aria-[current=page]:bg-white aria-[current=page]:shadow-sm"
              href={buildScheduleUrl({ ...state, view: "cart" })}
            >
              Planner cart
            </Link>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <p aria-live="polite" className="font-semibold">
              {state.classNumbers.length} selected Class
              {state.classNumbers.length === 1 ? "" : "es"}
            </p>
            {state.classNumbers.length > 0 ? (
              <CalendarActions
                url={buildCalendarUrl(state.termCode, state.classNumbers)}
              />
            ) : null}
            <SisParserDialog state={state} />
          </div>
        </div>

        {state.classNumbers.length >= MAX_PLANNER_CLASSES ? (
          <p
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
            role="status"
          >
            The planner cart is limited to {MAX_PLANNER_CLASSES} Classes. Remove
            a Class before adding or importing another.
          </p>
        ) : null}

        {conflicts.length > 0 ? (
          <section
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-950"
            role="alert"
          >
            <h2 className="font-bold">Schedule conflict</h2>
            <ul className="mt-2 list-disc pl-5">
              {conflicts.map(([left, right]) => (
                <li key={`${left}-${right}`}>
                  Classes {left} and {right} have overlapping meeting times.
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {state.view === "cart" ? (
          <section aria-labelledby="planner-cart" className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold" id="planner-cart">
                {page.term.termName} planner cart
              </h2>
              <p className="text-sm text-slate-600">
                Reload or share this URL to keep the same validated Classes.
              </p>
            </div>
            {selectedClasses.length === 0 ? (
              <p className="rounded-2xl border bg-slate-50 p-6" role="status">
                No Classes are selected. Browse Classes or import Class Numbers
                from SIS.
              </p>
            ) : (
              selectedClasses.map((scheduleClass) => (
                <ClassSummary
                  key={scheduleClass.classNumber}
                  scheduleClass={scheduleClass}
                  state={state}
                />
              ))
            )}
          </section>
        ) : (
          <section aria-labelledby="schedule-results" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-2xl font-bold" id="schedule-results">
                  {page.term.termName}
                </h2>
                <p className="text-sm text-slate-600">
                  {page.total} matching Course Offering
                  {page.total === 1 ? "" : "s"}
                  {page.total > page.results.length
                    ? ` · showing first ${page.results.length}`
                    : ""}
                </p>
              </div>
              <p className="font-mono text-xs text-slate-500">
                Schedule generation {page.generation.slice(0, 12)}
              </p>
            </div>

            {page.results.length === 0 ? (
              <p className="rounded-2xl border bg-slate-50 p-6" role="status">
                No Course Offerings match this search in {page.term.termName}.
              </p>
            ) : (
              page.results.map((offering) => (
                <article
                  className="overflow-hidden rounded-2xl border bg-white shadow-sm"
                  key={offering.courseId}
                >
                  <header className="border-b bg-slate-50 px-5 py-4">
                    <h3 className="text-lg font-bold">
                      <Link
                        href={coursePath(
                          offering.coursePrefix,
                          offering.courseNumber,
                          offering.termCode,
                        )}
                      >
                        {offering.courseCode} · {offering.title}
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {offering.credits} credits · {offering.career} ·{" "}
                      {offering.classes.length} Class
                      {offering.classes.length === 1 ? "" : "es"}
                    </p>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[880px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b text-left text-slate-600">
                          <th className="px-4 py-3" scope="col">
                            Class details
                          </th>
                          <th className="px-4 py-3" scope="col">
                            Meeting
                          </th>
                          <th className="px-4 py-3" scope="col">
                            Instructor
                          </th>
                          <th className="px-4 py-3" scope="col">
                            Room
                          </th>
                          <th className="px-4 py-3 text-right" scope="col">
                            Enrollment
                          </th>
                          <th className="px-4 py-3 text-right" scope="col">
                            Planner
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {offering.classes.flatMap((scheduleClass) => {
                          const meetings =
                            scheduleClass.meetings.length > 0
                              ? scheduleClass.meetings
                              : [undefined];
                          return meetings.map((meeting, index) => {
                            const roomUrl = meeting
                              ? PathAdvisor.findPathTo(meeting.room)
                              : undefined;
                            return (
                              <tr
                                className="border-b last:border-0"
                                key={`${scheduleClass.classNumber}-${meeting ? JSON.stringify(meeting) : "tba"}`}
                              >
                                {index === 0 ? (
                                  <th
                                    className="px-4 py-3 align-top font-semibold"
                                    rowSpan={meetings.length}
                                    scope="row"
                                  >
                                    <span>
                                      <span className="sr-only">
                                        Class details:{" "}
                                      </span>
                                      <Link
                                        href={coursePath(
                                          scheduleClass.coursePrefix,
                                          scheduleClass.courseNumber,
                                          scheduleClass.termCode,
                                          scheduleClass.section,
                                        )}
                                      >
                                        {scheduleClass.section} ·{" "}
                                        {scheduleClass.classNumber}
                                      </Link>
                                    </span>
                                  </th>
                                ) : null}
                                <td className="px-4 py-3 align-top">
                                  {meeting ? (
                                    <>
                                      <span className="block font-medium">
                                        {meeting.weekday} {meetingTime(meeting)}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {meetingDates(meeting)}
                                      </span>
                                    </>
                                  ) : (
                                    "Meeting TBA"
                                  )}
                                </td>
                                <td className="px-4 py-3 align-top">
                                  {meeting?.instructors.length
                                    ? meeting.instructors.map((instructor) => (
                                        <span
                                          className="block"
                                          key={instructor.sourceName}
                                        >
                                          {instructor.uuid ? (
                                            <Link
                                              href={instructorPath(
                                                instructor.uuid,
                                              )}
                                            >
                                              {instructor.sourceName}
                                            </Link>
                                          ) : (
                                            instructor.sourceName
                                          )}
                                        </span>
                                      ))
                                    : "TBA"}
                                </td>
                                <td className="px-4 py-3 align-top">
                                  {meeting && roomUrl ? (
                                    <a
                                      className="underline underline-offset-2"
                                      href={roomUrl}
                                      rel="noopener noreferrer"
                                      target="_blank"
                                    >
                                      {meeting.room}
                                    </a>
                                  ) : (
                                    meeting?.room || "TBA"
                                  )}
                                </td>
                                {index === 0 ? (
                                  <>
                                    <td
                                      className="px-4 py-3 text-right align-top tabular-nums"
                                      rowSpan={meetings.length}
                                    >
                                      {scheduleClass.enrollment}/
                                      {scheduleClass.capacity}
                                      {scheduleClass.waitlist > 0 ? (
                                        <span className="block text-xs text-slate-500">
                                          {scheduleClass.waitlist} waiting
                                        </span>
                                      ) : null}
                                    </td>
                                    <td
                                      className="px-4 py-3 text-right align-top"
                                      rowSpan={meetings.length}
                                    >
                                      <PlannerAction
                                        scheduleClass={scheduleClass}
                                        state={state}
                                      />
                                    </td>
                                  </>
                                ) : null}
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))
            )}
          </section>
        )}
      </section>
    </>
  );
}
