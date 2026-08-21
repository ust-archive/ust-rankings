import { CalendarPlusIcon, DownloadIcon, HelpCircleIcon } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  type CourseOffering,
  InvalidScheduleQueryError,
  querySchedule,
  resolveClasses,
  type ScheduleClass,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";
import { SisImportDialog } from "./sis-import-dialog";

export const dynamic = "force-dynamic";

type SearchParameters = Record<string, string | string[] | undefined>;
type DisplayOffering = Pick<
  CourseOffering,
  "coursePrefix" | "courseNumber" | "courseCode" | "title" | "classes"
>;

function stateUrl(state: PlannerState, changes: Partial<PlannerState>) {
  return buildScheduleUrl({ ...state, ...changes });
}

function selectedOfferings(classes: ScheduleClass[]): DisplayOffering[] {
  const offerings = new Map<string, DisplayOffering>();
  for (const scheduleClass of classes) {
    const existing = offerings.get(scheduleClass.courseCode) ?? {
      coursePrefix: scheduleClass.coursePrefix,
      courseNumber: scheduleClass.courseNumber,
      courseCode: scheduleClass.courseCode,
      title: scheduleClass.courseTitle,
      classes: [],
    };
    existing.classes.push(scheduleClass);
    offerings.set(scheduleClass.courseCode, existing);
  }
  return [...offerings.values()].sort((left, right) =>
    left.courseCode.localeCompare(right.courseCode),
  );
}

function Meeting({ meeting }: { meeting: ScheduleClass["meetings"][number] }) {
  const roomUrl = meeting.room
    ? PathAdvisor.findPathTo(meeting.room)
    : undefined;
  return (
    <div className="flex min-w-48 flex-col gap-1">
      <span>
        {meeting.weekday} {meeting.timeFrom ?? "Time TBA"}
        {meeting.timeTo ? `–${meeting.timeTo}` : ""}
      </span>
      {roomUrl ? (
        <a href={roomUrl} rel="noopener noreferrer" target="_blank">
          {meeting.room}
        </a>
      ) : (
        <span>{meeting.room || "Room TBA"}</span>
      )}
      <span>
        {meeting.instructors.length
          ? meeting.instructors.map((instructor, index) => (
              <span key={instructor.uuid ?? instructor.sourceName}>
                {index ? ", " : ""}
                {instructor.uuid ? (
                  <Link href={`/instructors/${instructor.uuid}`}>
                    {instructor.sourceName}
                  </Link>
                ) : (
                  instructor.sourceName
                )}
              </span>
            ))
          : "Instructor TBA"}
      </span>
    </div>
  );
}

function CourseCard({
  offering,
  state,
}: {
  offering: DisplayOffering;
  state: PlannerState;
}) {
  const selected = new Set(state.classNumbers);
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-xl">
            <Link
              href={`/courses/${offering.coursePrefix.toLowerCase()}/${offering.courseNumber.toLowerCase()}`}
            >
              {offering.courseCode}: {offering.title}
            </Link>
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="p-2" scope="col">
                  Section
                </th>
                <th className="p-2" scope="col">
                  Class
                </th>
                <th className="p-2" scope="col">
                  Meeting
                </th>
                <th className="p-2" scope="col">
                  Enrollment
                </th>
                <th className="p-2" scope="col">
                  Planner
                </th>
              </tr>
            </thead>
            <tbody>
              {offering.classes.map((scheduleClass) => {
                const isSelected = selected.has(scheduleClass.classNumber);
                const plannerFull =
                  !isSelected &&
                  state.classNumbers.length >= MAX_PLANNER_CLASSES;
                const classNumbers = isSelected
                  ? state.classNumbers.filter(
                      (classNumber) =>
                        classNumber !== scheduleClass.classNumber,
                    )
                  : [...state.classNumbers, scheduleClass.classNumber];
                return (
                  <tr
                    className="border-b border-slate-100 last:border-0"
                    key={scheduleClass.classNumber}
                  >
                    <th className="p-2 align-top" scope="row">
                      <Link
                        href={`/courses/${scheduleClass.coursePrefix.toLowerCase()}/${scheduleClass.courseNumber.toLowerCase()}/${scheduleClass.termCode}/${scheduleClass.section.toLowerCase()}`}
                      >
                        {scheduleClass.section}
                      </Link>
                      <div className="mt-1">
                        <Badge
                          variant={scheduleClass.open ? "secondary" : "outline"}
                        >
                          {scheduleClass.open ? "Open" : "Closed"}
                        </Badge>
                      </div>
                    </th>
                    <td className="p-2 align-top">
                      {scheduleClass.classNumber}
                    </td>
                    <td className="p-2 align-top">
                      <div className="flex flex-col gap-2">
                        {scheduleClass.meetings.length ? (
                          scheduleClass.meetings.map((meeting) => (
                            <Meeting
                              key={`${meeting.weekday}-${meeting.dateFrom}-${meeting.timeFrom}-${meeting.roomCode}`}
                              meeting={meeting}
                            />
                          ))
                        ) : (
                          <span>Meeting TBA</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 align-top">
                      {scheduleClass.enrollment}/{scheduleClass.capacity}
                      {scheduleClass.waitlist
                        ? ` · Wait ${scheduleClass.waitlist}`
                        : ""}
                      {scheduleClass.reservations.length ? (
                        <details className="mt-1">
                          <summary>Quotas</summary>
                          <ul>
                            {scheduleClass.reservations.map((reservation) => (
                              <li key={reservation.name}>
                                {reservation.name}: {reservation.enrollment}/
                                {reservation.quota}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td className="p-2 align-top">
                      {plannerFull ? (
                        <Button disabled size="sm">
                          Planner full
                        </Button>
                      ) : (
                        <Button
                          asChild
                          size="sm"
                          variant={isSelected ? "outline" : "default"}
                        >
                          <Link
                            href={stateUrl(state, {
                              classNumbers,
                              view: isSelected ? state.view : "cart",
                            })}
                          >
                            {isSelected ? "Remove" : "Add"}
                          </Link>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parsed = parsePlannerQuery(await searchParams);
  const messages = [...parsed.messages];
  let schedule: Awaited<ReturnType<typeof querySchedule>>;
  try {
    schedule = await querySchedule({
      termCode: parsed.termInvalid ? undefined : parsed.termCode,
      search: parsed.search,
    });
  } catch (error) {
    if (error instanceof InvalidScheduleQueryError) {
      messages.push(`${error.message} Showing the latest Term.`);
      schedule = await querySchedule({ search: parsed.search });
    } else if (error instanceof ScheduleUnavailableError) {
      return (
        <Alert className="max-w-2xl text-left" variant="destructive">
          <AlertTitle>UST Schedule is unavailable</AlertTitle>
          <AlertDescription>
            Schedule data could not be loaded. Rankings and the rest of the site
            remain available.
          </AlertDescription>
        </Alert>
      );
    } else throw error;
  }

  const state: PlannerState = {
    termCode: schedule.term.termCode,
    search: parsed.search,
    classNumbers: parsed.classNumbers,
    view: parsed.view,
  };
  let plannerClasses: ScheduleClass[] = [];
  if (state.classNumbers.length)
    try {
      plannerClasses = await resolveClasses(state.termCode, state.classNumbers);
    } catch (error) {
      messages.push(
        error instanceof InvalidScheduleQueryError
          ? error.message
          : "Selected Classes could not be loaded.",
      );
    }
  const conflicts = findPlannerConflicts(plannerClasses);
  const offerings =
    state.view === "cart"
      ? selectedOfferings(plannerClasses)
      : schedule.results;
  const calendarUrl = buildCalendarUrl(state.termCode, state.classNumbers);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 text-left">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-600">
          Planner
        </p>
        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          UST Schedule
        </h1>
        <p className="max-w-2xl text-slate-600">
          Browse Classes, build a shareable planner, check conflicts, and export
          your calendar.
        </p>
      </header>

      {messages.map((message) => (
        <Alert key={message}>
          <AlertTitle>Schedule notice</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}
      {conflicts.length ? (
        <Alert variant="destructive">
          <AlertTitle>Planner conflicts</AlertTitle>
          <AlertDescription>
            {conflicts
              .map(([left, right]) => `${left} conflicts with ${right}`)
              .join("; ")}
            .
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        aria-label="Schedule controls"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <form action="/schedule" className="flex flex-col gap-3 sm:flex-row">
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
            <Input
              aria-label="Search Schedule"
              defaultValue={state.search}
              name="q"
              placeholder="Search Course, Instructor, room, Section, or Class Number"
              type="search"
            />
            <Button type="submit">Search</Button>
          </form>
          <form action="/schedule" className="flex gap-2">
            <label className="sr-only" htmlFor="schedule-term">
              Term
            </label>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2"
              defaultValue={state.termCode}
              id="schedule-term"
              name="term"
            >
              {schedule.terms.map((term) => (
                <option key={term.termCode} value={term.termCode}>
                  {term.termName}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Change Term
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <details className="mr-auto max-w-2xl">
            <summary className="cursor-pointer font-semibold">
              <HelpCircleIcon className="mr-1 inline size-4" /> Help
            </summary>
            <p className="mt-2 text-sm text-slate-600">
              Search the current Term, add Classes to Planner, import Class
              Numbers from SIS, then review conflicts and calendar actions.
            </p>
          </details>
          <SisImportDialog state={state} />
          {state.classNumbers.length ? (
            <>
              <Button asChild variant="outline">
                <a href={`${calendarUrl}&download=1`}>
                  <DownloadIcon data-icon="inline-start" /> Download calendar
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={calendarUrl}>
                  <CalendarPlusIcon data-icon="inline-start" /> Calendar feed
                </a>
              </Button>
            </>
          ) : null}
        </div>
      </section>

      <nav aria-label="Schedule views" className="flex gap-2">
        <Button
          asChild
          variant={state.view === "browse" ? "default" : "outline"}
        >
          <Link href={stateUrl(state, { view: "browse" })}>Browse</Link>
        </Button>
        <Button asChild variant={state.view === "cart" ? "default" : "outline"}>
          <Link href={stateUrl(state, { view: "cart" })}>
            Planner ({state.classNumbers.length})
          </Link>
        </Button>
      </nav>

      <section className="flex flex-col gap-4" aria-live="polite">
        <header className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">
              {state.view === "cart"
                ? "Selected Classes"
                : schedule.term.termName}
            </h2>
            <p className="text-sm text-slate-600">
              {state.view === "cart"
                ? `${plannerClasses.length} selected`
                : `${schedule.total} Course${schedule.total === 1 ? "" : "s"}${schedule.total > schedule.results.length ? ` · showing first ${schedule.results.length}` : ""}`}
            </p>
          </div>
          <a href={stateUrl(state, {})}>Share this planner</a>
        </header>
        {offerings.length ? (
          offerings.map((offering) => (
            <CourseCard
              key={offering.courseCode}
              offering={offering}
              state={state}
            />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
            {state.view === "cart"
              ? "No Classes selected."
              : "No Courses match this search."}
          </p>
        )}
      </section>
    </div>
  );
}
