"use client";

import { HelpCircleIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { coursePath } from "@/app/courses/routes";
import { EntityLink } from "@/app/entity-navigation";
import { instructorPath } from "@/app/instructors/routes";
import { RankingSearch } from "@/app/rankings/ranking-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BrowserQueryError,
  querySchedulePage,
} from "@/lib/browser-query/client";
import { PathAdvisor } from "@/lib/schedule/path-advisor";
import {
  buildScheduleUrl,
  MAX_PLANNER_CLASSES,
  type PlannerState,
  parsePlannerQuery,
} from "@/lib/schedule/planner";
import type {
  CourseOffering,
  ScheduleClass,
  SchedulePage,
} from "@/lib/schedule/server";
import { CalendarDownload } from "./calendar-download";
import { CalendarSubscribe } from "./calendar-subscribe";
import { SisImportDialog } from "./sis-import-dialog";

type DisplayOffering = Pick<
  CourseOffering,
  "coursePrefix" | "courseNumber" | "courseCode" | "title" | "classes"
>;

function stateUrl(state: PlannerState, changes: Partial<PlannerState>) {
  return buildScheduleUrl({ ...state, ...changes });
}

type ScheduleCell = {
  key: string;
  content: ReactNode;
  rowSpan: number;
  hidden: boolean;
};

function CourseCard({
  offering,
  state,
}: {
  offering: DisplayOffering;
  state: PlannerState;
}) {
  const rows = offering.classes.flatMap((clazz) => {
    const multiplePeriods =
      new Set(
        clazz.meetings.map(
          (meeting) => `${meeting.dateFrom}/${meeting.dateTo}`,
        ),
      ).size > 1;
    const selected = state.classNumbers.includes(clazz.classNumber);
    const full = !selected && state.classNumbers.length >= MAX_PLANNER_CLASSES;
    const groups: {
      meeting: ScheduleClass["meetings"][number];
      days: string[];
    }[] = [];
    for (const meeting of clazz.meetings) {
      const match = groups.find(
        ({ meeting: other }) =>
          other.timeFrom === meeting.timeFrom &&
          other.timeTo === meeting.timeTo &&
          other.dateFrom === meeting.dateFrom &&
          other.dateTo === meeting.dateTo &&
          other.room === meeting.room &&
          JSON.stringify(other.instructors) ===
            JSON.stringify(meeting.instructors),
      );
      if (match) match.days.push(meeting.weekday.slice(0, 2));
      else groups.push({ meeting, days: [meeting.weekday.slice(0, 2)] });
    }
    return (groups.length ? groups : [undefined]).map((group) => {
      const meeting = group?.meeting;
      const cells: [string, ReactNode][] = [
        [
          String(clazz.classNumber),
          <Button
            key={clazz.classNumber}
            disabled={full}
            aria-pressed={selected}
            aria-label={`${selected ? "Remove" : "Add"} ${offering.courseCode} ${clazz.section} (${clazz.classNumber})`}
            variant={selected ? "default" : "secondary"}
            className="h-full min-h-12 w-full flex-col gap-0 px-1 py-2 text-xs sm:px-3 sm:text-sm"
            onClick={() => {
              window.history.pushState(
                null,
                "",
                stateUrl(state, {
                  classNumbers: selected
                    ? state.classNumbers.filter((n) => n !== clazz.classNumber)
                    : [...state.classNumbers, clazz.classNumber],
                }),
              );
              toast(
                `${offering.courseCode} ${clazz.section} ${selected ? "removed from" : "added to"} shopping cart.`,
              );
            }}
          >
            {full ? (
              "Cart full"
            ) : (
              <>
                <span>{clazz.section}</span> <span>({clazz.classNumber})</span>
              </>
            )}
          </Button>,
        ],
        [
          JSON.stringify(group) ?? "undated",
          group ? (
            <>
              <span className="whitespace-nowrap">{group.days.join("")} </span>{" "}
              <span className="whitespace-nowrap">
                {meeting?.timeFrom ?? "Time TBA"}
                {meeting?.timeTo ? `-${meeting.timeTo}` : ""}
              </span>
              {(multiplePeriods || meeting?.dateFrom === meeting?.dateTo) &&
              meeting?.dateFrom &&
              meeting.dateTo ? (
                <span className="block whitespace-nowrap text-xs text-slate-500">
                  {meeting.dateFrom}
                  {meeting.dateTo !== meeting.dateFrom
                    ? `–${meeting.dateTo}`
                    : ""}
                </span>
              ) : null}
            </>
          ) : (
            "TBA"
          ),
        ],
        [
          JSON.stringify(meeting?.instructors ?? []),
          meeting?.instructors.length
            ? meeting.instructors.map((i) => (
                <span
                  className="block whitespace-nowrap"
                  key={i.uuid ?? i.sourceName}
                >
                  {i.uuid ? (
                    <EntityLink
                      style={{ textDecoration: "none" }}
                      href={instructorPath(i.uuid)}
                    >
                      {i.sourceName}
                    </EntityLink>
                  ) : (
                    i.sourceName
                  )}
                </span>
              ))
            : "TBA",
        ],
        [
          meeting?.room ?? "",
          meeting?.room ? (
            <div key="room" className="flex flex-col">
              <a
                href={PathAdvisor.findPathTo(meeting.room)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {meeting.room
                  .replace(/ \(\d+\)$/, "")
                  .split(", ")
                  .map((part, index, parts) => (
                    <span className="whitespace-nowrap" key={part}>
                      {part}
                      {index < parts.length - 1 ? ", " : ""}
                    </span>
                  ))}
              </a>
            </div>
          ) : (
            "TBA"
          ),
        ],
      ];
      return {
        key: `${clazz.classNumber}-${JSON.stringify(group)}`,
        cells: cells.map(
          ([key, content]): ScheduleCell => ({
            key,
            content,
            rowSpan: 1,
            hidden: false,
          }),
        ),
      };
    });
  });
  // Preserve the original table's adjacent-cell merging, independently in each column.
  const previous: (ScheduleCell | undefined)[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, column) => {
      const above = previous[column];
      if (above && above.key === cell.key) {
        above.rowSpan++;
        cell.hidden = true;
      } else previous[column] = cell;
    });
  }
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden border-slate-300 bg-white shadow-sm [contain-intrinsic-size:auto_32rem] [content-visibility:auto]">
      <CardHeader className="flex w-full flex-row items-center gap-1.5 p-4 sm:p-6">
        <div className="min-w-0 space-y-1 text-left">
          <CardTitle className="tracking-tight">
            <EntityLink
              style={{ textDecoration: "none" }}
              href={coursePath(
                offering.coursePrefix,
                offering.courseNumber,
                state.termCode,
              )}
            >
              {offering.courseCode}
            </EntityLink>
          </CardTitle>
          <CardDescription className="break-words text-pretty leading-relaxed">
            {offering.title}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <section
          aria-label={`${offering.courseCode} Classes`}
          className="overflow-auto rounded-lg bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the wide Class table.
          tabIndex={0}
        >
          <table className="w-full table-auto overflow-auto border border-gray-200 font-mono text-xs text-center sm:text-sm">
            <thead>
              <tr>
                {["Section", "Schedule", "Instructors", "Room"].map((label) => (
                  <th key={label} className="p-2" scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="h-0">
                  {row.cells.map((cell, column) =>
                    cell.hidden ? null : (
                      <td
                        key={
                          ["section", "schedule", "instructors", "room"][column]
                        }
                        rowSpan={cell.rowSpan}
                        className={`h-[inherit] border border-gray-200 ${column === 0 ? "p-1" : "p-2"}`}
                      >
                        {cell.content}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </CardContent>
    </Card>
  );
}

function ScheduleCardSkeletons() {
  return (
    <div
      role="status"
      aria-label="Loading Schedule"
      className="flex w-full flex-col gap-2"
    >
      <span className="sr-only">Loading Schedule…</span>
      {["first", "second", "third"].map((card) => (
        <Card
          key={card}
          aria-hidden="true"
          className="motion-safe:animate-pulse"
        >
          <CardHeader className="gap-2">
            <div className="h-6 w-36 rounded bg-slate-200" />
            <div className="h-4 w-3/4 rounded bg-slate-100" />
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="overflow-hidden border border-gray-200 bg-slate-50">
              {["head", "one", "two", "three"].map((row) => (
                <div
                  key={row}
                  className="grid grid-cols-4 border-b border-gray-200 last:border-0"
                >
                  {["section", "time", "instructor", "room"].map((column) => (
                    <div
                      key={column}
                      className="border-r border-gray-200 p-3 last:border-0"
                    >
                      <div
                        className={`${row === "head" ? "h-4" : "h-8"} rounded bg-slate-200`}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SchedulePageClient() {
  const searchParams = useSearchParams();
  const parsed = useMemo(() => {
    const parameters: Record<string, string | string[]> = {};
    for (const key of new Set(searchParams.keys())) {
      const values = searchParams.getAll(key);
      parameters[key] = values.length === 1 ? values[0] : values;
    }
    return parsePlannerQuery(parameters);
  }, [searchParams]);
  const [showHelp, setShowHelp] = useState(false);
  const [schedule, setSchedule] = useState<SchedulePage>();
  const [loadedFor, setLoadedFor] = useState<typeof parsed>();
  const knownClasses = useMemo(
    () =>
      new Map(
        [
          ...(schedule?.results.flatMap((offering) => offering.classes) ?? []),
          ...(schedule?.plannerOfferings.flatMap(
            (offering) => offering.classes,
          ) ?? []),
        ].map((clazz) => [clazz.classNumber, clazz]),
      ),
    [schedule],
  );
  const requestedTermCode = parsed.termCode || schedule?.terms.at(-1)?.termCode;
  const needsQuery =
    !schedule ||
    parsed.termInvalid ||
    (requestedTermCode && requestedTermCode !== schedule.term.termCode) ||
    parsed.search !== schedule.search ||
    parsed.classNumbers.some(
      (number) =>
        !knownClasses.has(number) &&
        !schedule.invalidClassNumbers.includes(number),
    );
  const loading = loadedFor !== parsed && Boolean(needsQuery);
  const [messages, setMessages] = useState(parsed.messages);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!needsQuery) {
      setMessages(parsed.messages);
      setFailed(false);
      return;
    }
    if (loadedFor === parsed) return;
    let current = true;
    setFailed(false);
    setMessages(parsed.messages);
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
      if (current) {
        setSchedule(result);
        setLoadedFor(parsed);
      }
    }
    void load().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [parsed, needsQuery, loadedFor]);

  if (!schedule || failed)
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-8 text-center pt-12 lg:pt-16">
        <h1 className="text-logo-gradient max-w-sm text-6xl min-[375px]:text-7xl font-bold tracking-tighter lg:max-w-2xl">
          UST Schedule
        </h1>
        {parsed.messages.map((message) => (
          <Alert key={message}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ))}
        {failed ? (
          <Alert variant="destructive">
            <AlertTitle>UST Schedule is unavailable</AlertTitle>
            <AlertDescription>
              Schedule data could not be loaded. Rankings and the rest of the
              site remain available.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div
              aria-hidden="true"
              className="flex h-12 w-full max-w-2xl gap-4 motion-safe:animate-pulse"
            >
              <div className="flex-1 rounded-full bg-slate-200" />
              <div className="w-36 rounded bg-slate-200" />
            </div>
            <div className="w-full">
              <div
                aria-hidden="true"
                className="mx-auto mb-8 h-10 w-48 rounded bg-slate-200 motion-safe:animate-pulse"
              />
              <ScheduleCardSkeletons />
            </div>
          </>
        )}
      </div>
    );

  const state: PlannerState = {
    termCode: schedule.term.termCode,
    search: parsed.search,
    classNumbers:
      parsed.termInvalid ||
      (requestedTermCode && requestedTermCode !== schedule.term.termCode)
        ? []
        : parsed.classNumbers,
    view: parsed.view,
  };
  const plannerClasses = state.classNumbers.flatMap((number) => {
    const clazz = knownClasses.get(number);
    return clazz ? [clazz] : [];
  });
  const invalidClassNumbers = state.classNumbers.filter(
    (number) => !knownClasses.has(number),
  );
  const plannerClassNumbers = plannerClasses.map(
    (scheduleClass) => scheduleClass.classNumber,
  );

  const requestedTerm =
    schedule.terms.find((term) => term.termCode === requestedTermCode) ??
    schedule.term;

  const offerings =
    state.view === "cart"
      ? [
          ...new Map(
            [...schedule.results, ...schedule.plannerOfferings].map(
              (offering) => [offering.courseCode, offering],
            ),
          ).values(),
        ].filter((offering) =>
          offering.classes.some((clazz) =>
            state.classNumbers.includes(clazz.classNumber),
          ),
        )
      : schedule.results;

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-8 text-center pt-12 lg:pt-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-logo-gradient max-w-sm text-6xl min-[375px]:text-7xl font-bold tracking-tighter lg:max-w-2xl">
          UST Schedule
        </h1>
      </header>

      {messages.map((message) => (
        <Alert key={message}>
          <AlertTitle>Schedule notice</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}
      {!loading && invalidClassNumbers.length ? (
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

      <section className="w-full max-w-2xl" aria-label="Schedule controls">
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-4">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <RankingSearch
              entity="schedule"
              initialValue={parsed.search ?? ""}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Help"
            aria-expanded={showHelp}
            aria-controls="schedule-help"
            onClick={() => setShowHelp(!showHelp)}
          >
            <HelpCircleIcon />
          </Button>
          <CalendarDownload
            classes={plannerClasses}
            disabled={
              !plannerClassNumbers.length ||
              invalidClassNumbers.length > 0 ||
              loading
            }
          />
          <CalendarSubscribe
            termCode={state.termCode}
            classNumbers={plannerClassNumbers}
            disabled={
              !plannerClassNumbers.length ||
              invalidClassNumbers.length > 0 ||
              loading
            }
          />
          <Combobox
            items={schedule.terms}
            value={requestedTerm}
            itemToStringLabel={(term) => term.termName}
            isItemEqualToValue={(a, b) => a.termCode === b.termCode}
            onValueChange={(term) => {
              if (term && term.termCode !== requestedTerm.termCode)
                window.history.pushState(
                  null,
                  "",
                  stateUrl(state, {
                    termCode: term.termCode,
                    classNumbers: [],
                  }),
                );
            }}
          >
            <ComboboxInput
              aria-label="Term"
              className="w-fit max-w-full shrink-0 bg-white [&_input]:field-sizing-content [&_input]:min-w-0 [&_input]:w-auto [&_input]:flex-initial"
            />
            <ComboboxContent>
              <ComboboxEmpty>No Terms found.</ComboboxEmpty>
              <ComboboxList>
                {(term) => (
                  <ComboboxItem key={term.termCode} value={term}>
                    {term.termName}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <Collapsible open={showHelp}>
          <CollapsibleContent className="overflow-hidden motion-safe:data-[state=open]:animate-slideDown motion-safe:data-[state=closed]:animate-slideUp">
            <article
              id="schedule-help"
              className="space-y-1 p-8 pb-0 text-left text-sm"
            >
              <p>
                Search for courses by their name, code, instructors, room or
                section number.
              </p>
              <ul className="list-disc space-y-2">
                <li>
                  Click (or tap) on sections to add them to (or remove them
                  from) the shopping cart.
                </li>
                <li>
                  Click the download icon to download the schedules in the
                  shopping cart. Import the downloaded file into your calendar
                  app manually.
                </li>
                <li>Click on rooms to find their location by Path Advisor.</li>
              </ul>
              <p>
                Changing Term clears selected Classes. Calendar downloads are
                snapshots. Use the subscribe icon to follow updates in your
                calendar app.
              </p>
            </article>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <section className="w-full">
        <Tabs
          value={state.view}
          onValueChange={(view) =>
            window.history.pushState(
              null,
              "",
              stateUrl(state, { view: view as PlannerState["view"] }),
            )
          }
        >
          <TabsList aria-label="Schedule views">
            <TabsTrigger value="browse">All</TabsTrigger>
            <TabsTrigger value="cart">Shopping Cart</TabsTrigger>
          </TabsList>
          <TabsContent key={state.view} value={state.view}>
            {state.view === "cart" ? (
              <div className="mb-2">
                <SisImportDialog state={state} />
                <Separator className="mt-2" />
              </div>
            ) : null}
            <section className="flex flex-col gap-2" aria-live="polite">
              <header className={loading ? "invisible" : undefined}>
                <h2 className="sr-only">
                  {state.view === "cart"
                    ? "Selected Classes"
                    : schedule.term.termName}
                </h2>
              </header>
              {loading ? (
                <ScheduleCardSkeletons />
              ) : offerings.length ? (
                offerings.map((offering) => (
                  <CourseCard
                    key={offering.courseCode}
                    offering={offering}
                    state={state}
                  />
                ))
              ) : (
                <p className="p-8 text-center text-sm text-slate-600">
                  {state.view === "cart"
                    ? "No Classes selected."
                    : "No Courses match this search."}
                </p>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
