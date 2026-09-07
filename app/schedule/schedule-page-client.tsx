"use client";

import { HelpCircleIcon } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { useEffect, useState } from "react";
import { coursePath } from "@/app/courses/routes";
import { EntityLink } from "@/app/entity-navigation";
import { instructorPath } from "@/app/instructors/routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  BrowserQueryError,
  querySchedulePage,
} from "@/lib/browser-query/client";
import { PathAdvisor } from "@/lib/schedule/path-advisor";
import {
  buildScheduleUrl,
  findPlannerConflicts,
  MAX_PLANNER_CLASSES,
  type PlannerState,
  type parsePlannerQuery,
} from "@/lib/schedule/planner";
import type {
  CourseOffering,
  ScheduleClass,
  SchedulePage,
} from "@/lib/schedule/server";
import { CalendarDownload } from "./calendar-download";
import { SisImportDialog } from "./sis-import-dialog";

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
      <span className="text-xs text-slate-600">
        {meeting.dateFrom ?? "Dates TBA"}
        {meeting.dateTo ? `–${meeting.dateTo}` : ""}
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
                  <EntityLink href={instructorPath(instructor.uuid)}>
                    {instructor.sourceName}
                  </EntityLink>
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
    <Card className="[contain-intrinsic-size:auto_32rem] [content-visibility:auto]">
      <CardHeader>
        <CardTitle asChild>
          <h3 className="text-xl">
            <EntityLink
              href={coursePath(
                offering.coursePrefix,
                offering.courseNumber,
                state.termCode,
              )}
            >
              {offering.courseCode}: {offering.title}
            </EntityLink>
          </h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-slate-600 sm:hidden">
          Scroll the table for enrollment and planner actions.
        </p>
        <section
          aria-label={`${offering.courseCode} Classes`}
          className="max-w-full overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the wide Class table.
          tabIndex={0}
        >
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
                      <EntityLink
                        href={coursePath(
                          scheduleClass.coursePrefix,
                          scheduleClass.courseNumber,
                          scheduleClass.termCode,
                          scheduleClass.section,
                        )}
                      >
                        {scheduleClass.section}
                      </EntityLink>
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
        </section>
      </CardContent>
    </Card>
  );
}

export function SchedulePageClient({
  parsed,
}: {
  parsed: ReturnType<typeof parsePlannerQuery>;
}) {
  const [schedule, setSchedule] = useState<SchedulePage>();
  const [messages, setMessages] = useState(parsed.messages);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    async function load() {
      let result: SchedulePage;
      const input = {
        termCode: parsed.termInvalid ? undefined : parsed.termCode,
        search: parsed.search,
        classNumbers: parsed.termInvalid ? [] : parsed.classNumbers,
      };
      try {
        result = await querySchedulePage(input);
      } catch (error) {
        if (!(error instanceof BrowserQueryError) || error.code !== "invalid")
          throw error;
        // Class Numbers belong to a Term. Never silently move a selection to another Term.
        result = await querySchedulePage({ search: parsed.search });
        if (current)
          setMessages([
            ...parsed.messages,
            `${error.message} Showing the latest Term with no Classes selected.`,
          ]);
      }
      if (current) setSchedule(result);
    }
    void load().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [parsed]);

  if (!schedule)
    return (
      <div className="flex w-full max-w-5xl flex-col gap-6 text-left">
        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          UST Schedule
        </h1>
        {parsed.messages.map((message) => (
          <Alert key={message}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ))}
        <Alert variant={failed ? "destructive" : "default"}>
          {failed ? (
            <>
              <AlertTitle>UST Schedule is unavailable</AlertTitle>
              <AlertDescription>
                Schedule data could not be loaded. Rankings and the rest of the
                site remain available.
              </AlertDescription>
            </>
          ) : (
            <>
              <Spinner aria-hidden="true" />
              <AlertDescription>Loading Schedule…</AlertDescription>
            </>
          )}
        </Alert>
      </div>
    );

  const state: PlannerState = {
    termCode: schedule.term.termCode,
    search: parsed.search,
    classNumbers:
      parsed.termInvalid ||
      (parsed.termCode && parsed.termCode !== schedule.term.termCode)
        ? []
        : parsed.classNumbers,
    view: parsed.view,
  };
  const { plannerClasses, invalidClassNumbers } = schedule;
  const plannerClassNumbers = plannerClasses.map(
    (scheduleClass) => scheduleClass.classNumber,
  );
  const conflicts = findPlannerConflicts(plannerClasses);
  const offerings =
    state.view === "cart"
      ? selectedOfferings(plannerClasses)
      : schedule.results;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 text-left">
      <header className="flex flex-col gap-2">
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
      {invalidClassNumbers.length ? (
        <Alert variant="destructive">
          <AlertTitle>Unknown Classes</AlertTitle>
          <AlertDescription>
            Class Number{invalidClassNumbers.length === 1 ? "" : "s"}{" "}
            {invalidClassNumbers.join(", ")} could not be found in this Term.{" "}
            <Link
              className="font-semibold underline"
              href={stateUrl(state, { classNumbers: plannerClassNumbers })}
            >
              Remove invalid Classes
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}
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
          <Form action="/schedule" className="flex flex-col gap-3 sm:flex-row">
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
              autoComplete="off"
              defaultValue={state.search}
              name="q"
              maxLength={100}
              placeholder="Search Courses, Instructors, or rooms…"
              type="search"
            />
            <Button type="submit">Search</Button>
          </Form>
          <Form action="/schedule" className="flex flex-wrap gap-2">
            {state.search ? (
              <input name="q" type="hidden" value={state.search} />
            ) : null}
            <label className="sr-only" htmlFor="schedule-term">
              Term
            </label>
            <select
              className="min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950"
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
          </Form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <details className="mr-auto max-w-2xl">
            <summary className="cursor-pointer font-semibold">
              <HelpCircleIcon className="mr-1 inline size-4" /> Help
            </summary>
            <p className="mt-2 text-sm text-slate-600">
              Search the current Term, add Classes to Planner, import Class
              Numbers from SIS, then review conflicts and download a calendar.
              Changing Term clears selected Classes. Calendar downloads are a
              snapshot; calendar subscriptions are temporarily unavailable.
            </p>
          </details>
          <SisImportDialog state={state} />
          {plannerClassNumbers.length > 0 &&
          invalidClassNumbers.length === 0 ? (
            <CalendarDownload classes={plannerClasses} />
          ) : null}
        </div>
      </section>

      <nav aria-label="Schedule views" className="flex gap-2">
        <Button
          asChild
          variant={state.view === "browse" ? "default" : "outline"}
        >
          <Link
            aria-current={state.view === "browse" ? "page" : undefined}
            href={stateUrl(state, { view: "browse" })}
          >
            Browse
          </Link>
        </Button>
        <Button asChild variant={state.view === "cart" ? "default" : "outline"}>
          <Link
            aria-current={state.view === "cart" ? "page" : undefined}
            href={stateUrl(state, { view: "cart" })}
          >
            Planner ({plannerClassNumbers.length})
          </Link>
        </Button>
      </nav>

      <section className="flex flex-col gap-4" aria-live="polite">
        <header>
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
