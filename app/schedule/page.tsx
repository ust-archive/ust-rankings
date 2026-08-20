import { Search } from "lucide-react";
import { NewReleaseBanner } from "@/components/component/new-release-banner";
import { PathAdvisor } from "@/data/cq/path-advisor";
import {
  InvalidScheduleQueryError,
  querySchedule,
  type ScheduleMeeting,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

type SearchParams = Record<string, string | string[] | undefined>;

function value(parameter: string | string[] | undefined) {
  return Array.isArray(parameter) ? parameter[0] : parameter;
}

function meetingTime(meeting: ScheduleMeeting) {
  return meeting.timeFrom && meeting.timeTo
    ? `${meeting.timeFrom}–${meeting.timeTo}`
    : "Time TBA";
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

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const parameters = await searchParams;
  const termCode = value(parameters.term);
  const search = value(parameters.q);
  let page: Awaited<ReturnType<typeof querySchedule>>;
  try {
    page = await querySchedule({ termCode, search });
  } catch (error) {
    return (
      <>
        <h1 className="text-logo-gradient max-w-sm text-6xl font-bold tracking-tighter sm:text-7xl lg:max-w-2xl">
          UST Schedule
        </h1>
        {error instanceof InvalidScheduleQueryError ? (
          <ErrorState title="Invalid Schedule query" message={error.message} />
        ) : error instanceof ScheduleUnavailableError ? (
          <ErrorState
            title="UST Schedule is unavailable"
            message="The validated Schedule generation could not be loaded. Rankings and other public pages remain available."
          />
        ) : (
          <ErrorState
            title="UST Schedule is unavailable"
            message="Schedule data could not be read right now."
          />
        )}
      </>
    );
  }

  return (
    <>
      <NewReleaseBanner className="-mt-12" />
      <header className="w-[calc(100vw-2rem)] max-w-5xl text-left">
        <h1 className="text-logo-gradient text-6xl font-bold tracking-tighter sm:text-7xl">
          UST Schedule
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Browse Course Offerings and Classes by Course information, Instructor,
          room, Section, or Class Number.
        </p>
      </header>

      <form
        action="/schedule"
        className="grid w-[calc(100vw-2rem)] max-w-5xl gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm sm:grid-cols-[minmax(12rem,16rem)_1fr_auto]"
      >
        <label className="grid gap-1 text-sm font-semibold" htmlFor="term">
          Term
          <select
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 font-normal"
            defaultValue={page.term.termCode}
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
        <label className="grid gap-1 text-sm font-semibold" htmlFor="q">
          Search Schedule
          <input
            className="h-11 rounded-lg border border-slate-300 px-4 font-normal"
            defaultValue={page.search ?? ""}
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
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </button>
      </form>

      <section
        aria-labelledby="schedule-results"
        className="w-[calc(100vw-2rem)] max-w-5xl space-y-4 text-left"
      >
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
                  {offering.courseCode} · {offering.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {offering.credits} credits · {offering.career} ·{" "}
                  {offering.classes.length} Class
                  {offering.classes.length === 1 ? "" : "es"}
                </p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-600">
                      <th className="px-4 py-3" scope="col">
                        Section / Class Number
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
                                <span className="block">
                                  {scheduleClass.section}
                                </span>
                                <span className="font-mono text-xs font-normal text-slate-500">
                                  {scheduleClass.classNumber}
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
                                    {meeting.dateFrom}–{meeting.dateTo}
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
                                      {instructor.sourceName}
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
    </>
  );
}
