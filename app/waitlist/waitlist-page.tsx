"use client";

import { ChevronDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RankingSearch } from "@/app/rankings/ranking-search";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  BrowserQueryError,
  queryWaitlistPlan,
  queryWaitlistSearch,
} from "@/lib/browser-query/client";
import type {
  WaitlistClass,
  WaitlistCourseOffering,
  WaitlistPlanResult,
  WaitlistSearchResult,
  WaitlistUnsupportedReason,
} from "@/lib/browser-query/protocol";

const dateFormatter = new Intl.DateTimeFormat("en-HK", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Hong_Kong",
});
const numberFormatter = new Intl.NumberFormat("en");

type SupportedPlan = Extract<WaitlistPlanResult, { status: "supported" }>;
type CardState = {
  expanded: boolean;
  loading: boolean;
  positions: Record<string, string>;
  result?: SupportedPlan;
  selectedSections: string[];
  submittedKey?: string;
  error?: string;
};
type CardUpdate = (current: CardState) => CardState;

type WaitlistSchedule = Record<string, unknown>;

function newCardState(): CardState {
  return {
    expanded: false,
    loading: false,
    positions: {},
    selectedSections: [],
  };
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function scheduleText(item: WaitlistSchedule, key: string) {
  return text(item[key]).trim();
}

function scheduleTime(item: WaitlistSchedule, key: string) {
  const value = item[key];
  const micros = typeof value === "number" ? value : Number(value);
  if (Number.isSafeInteger(micros) && micros >= 0) {
    const minutes = Math.floor(micros / 60_000_000);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
      minutes % 60,
    ).padStart(2, "0")}`;
  }
  return scheduleText(item, key).replace(/:00$/, "");
}

function meetingLabel(schedules: readonly WaitlistSchedule[]) {
  if (!schedules.length) return "No meeting published";
  return schedules
    .map((meeting) =>
      [
        scheduleText(meeting, "weekday"),
        [scheduleTime(meeting, "time_from"), scheduleTime(meeting, "time_to")]
          .filter(Boolean)
          .join("–"),
        scheduleText(meeting, "venue_name") || scheduleText(meeting, "venue"),
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean)
    .join("; ");
}

function instructorLabel(schedules: readonly WaitlistSchedule[]) {
  const names = [
    ...new Set(
      schedules.flatMap((meeting) =>
        Array.isArray(meeting.instructors)
          ? meeting.instructors
              .map((value) => text(value).trim())
              .filter(Boolean)
          : [],
      ),
    ),
  ];
  return names.length ? names.join(", ") : "Not specified";
}

function reservationLabel(classItem: WaitlistClass) {
  if (!classItem.reservations.length) return "None reported";
  return classItem.reservations
    .map(
      (reservation) =>
        `${reservation.name || "Reserved quota"}: ${numberFormatter.format(
          reservation.enrollment,
        )}/${numberFormatter.format(reservation.quota)} enrolled`,
    )
    .join("; ");
}

function unsupportedLabel(reason?: WaitlistUnsupportedReason) {
  switch (reason) {
    case "consent-required":
      return "Consent required before this evidence can be shown.";
    case "inactive":
      return "Class is inactive in the current Term.";
    case "non-waitlisted":
      return "No waitlist is currently reported for this Class.";
    case "missing-date":
      return "Observation date is missing.";
    case "missing-activation":
      return "Queue Activation was not observed after normal Class enrollment started.";
    default:
      return "This Class cannot be used in a Waitlist Plan.";
  }
}

function positionError(classItem: WaitlistClass, value: string) {
  if (!value.trim()) return "Enter a positive queue position.";
  if (!/^\d+$/.test(value)) return "Queue position must be a positive integer.";
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position <= 0)
    return "Queue position must be a positive integer.";
  if (position > classItem.waitlist)
    return `Queue position cannot exceed the current wait of ${classItem.waitlist}.`;
  return undefined;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function average(value: number | undefined) {
  return value === undefined ? "not available" : value.toFixed(1);
}

function scenarioLabel(name: "current" | "venue" | "historical-large") {
  switch (name) {
    case "current":
      return "No capacity adjustment (current Class)";
    case "venue":
      return "Current room capacity";
    case "historical-large":
      return "Larger historical venue";
  }
}

function WaitlistEvidenceResult({ result }: { result: SupportedPlan }) {
  const idPrefix = `waitlist-${result.course.replaceAll(" ", "-").toLowerCase()}`;
  const summaryHeadingId = `${idPrefix}-summary-heading`;
  const componentsHeadingId = `${idPrefix}-components-heading`;
  const timingHeadingId = `${idPrefix}-timing-heading`;
  return (
    <section
      aria-label="Historical Queue Evidence result"
      aria-live="polite"
      className="flex flex-col gap-4 rounded-lg border border-blue-200 bg-blue-50 p-4 sm:p-5"
    >
      <header className="flex flex-col gap-2">
        <Badge className="w-fit" variant="secondary">
          Historical Queue Evidence
        </Badge>
        <p className="text-3xl font-bold tracking-tight text-slate-950">
          {result.headline}
        </p>
        <p className="text-sm leading-relaxed text-slate-700">
          Aggregate queue movement only. Not an individual enrollment
          probability.
        </p>
      </header>
      <details className="rounded-md border border-blue-200 bg-white p-3">
        <summary className="cursor-pointer font-semibold text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2">
          Evidence details
        </summary>
        <div className="mt-4 flex flex-col gap-5 text-sm text-slate-700">
          <section aria-labelledby={summaryHeadingId}>
            <h4 className="font-semibold text-slate-950" id={summaryHeadingId}>
              Evidence and smoothing
            </h4>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <dt>Exact comparable history</dt>
                <dd className="font-semibold text-slate-950">
                  {numberFormatter.format(result.exactHistoryCount)} samples
                </dd>
              </div>
              <div>
                <dt>Broader pattern history</dt>
                <dd className="font-semibold text-slate-950">
                  {numberFormatter.format(result.broaderHistoryCount)} samples
                </dd>
              </div>
              <div>
                <dt>Prior influence</dt>
                <dd className="font-semibold text-slate-950">
                  {percent(result.prior.influence)}
                </dd>
              </div>
              <div>
                <dt>Joint outcome</dt>
                <dd className="font-semibold text-slate-950">
                  {result.joint.successes}/{result.joint.samples} comparable
                  Course Offerings cleared every required Class
                </dd>
              </div>
            </dl>
            <p className="mt-3 break-words font-mono text-xs leading-relaxed">
              Smoothing formula: ({result.smoothing.successes} +{" "}
              {result.smoothing.priorWeight} ×{" "}
              {result.smoothing.priorRate.toFixed(3)}) ÷ ({" "}
              {result.smoothing.exactSamples} + {result.smoothing.priorWeight})
              = {result.smoothing.estimate.toFixed(3)}
            </p>
            <p className="mt-2 leading-relaxed">
              The margin is an estimated bounded uncertainty display, not a
              calibrated confidence interval. Historical samples are matched by
              Course, component pattern, Season, and timing.
            </p>
          </section>

          <section aria-labelledby={componentsHeadingId}>
            <h4
              className="font-semibold text-slate-950"
              id={componentsHeadingId}
            >
              Per-Class evidence
            </h4>
            <ul
              className="mt-2 flex list-none flex-col gap-3 p-0"
              style={{ listStyle: "none", marginInlineStart: 0 }}
            >
              {result.components.map((component) => (
                <li
                  className="rounded-md border border-slate-200 p-3"
                  key={component.section}
                >
                  <p className="font-semibold text-slate-950">
                    {component.section} · {component.type} · queue position{" "}
                    {component.position}
                  </p>
                  <p>
                    {component.historical.successes}/
                    {component.historical.samples} comparable Course Offerings
                    cleared this position; average net reduction{" "}
                    {average(component.historical.averageNetReduction)}; average
                    gross exits{" "}
                    {average(component.historical.averageGrossExits)}.
                  </p>
                  {component.historical.minimumNetReduction !== undefined ? (
                    <p>
                      Observed net reduction range:{" "}
                      {component.historical.minimumNetReduction}–
                      {component.historical.maximumNetReduction}.
                    </p>
                  ) : null}
                  <p>
                    Queue Activation:{" "}
                    {component.activationAt
                      ? formatDate(component.activationAt)
                      : "not observed"}
                    {component.activationHours === undefined
                      ? ""
                      : ` · ${component.activationHours.toFixed(1)} hours since activation`}
                    .
                  </p>
                  <p>
                    Current observation: {component.current.enrollment}/
                    {component.current.capacity} enrolled, wait{" "}
                    {component.current.waitlist}; reservations:{" "}
                    {reservationLabel({
                      section: component.section,
                      classNumber: component.classNumber,
                      classType: component.type,
                      capacity: component.current.capacity,
                      enrollment: component.current.enrollment,
                      waitlist: component.current.waitlist,
                      consent: component.current.consent,
                      open: component.current.open,
                      schedules: [],
                      reservations: component.current.reservations,
                      eligible: true,
                    })}
                    .
                  </p>
                  <ul
                    className="mt-2 flex list-none flex-col gap-1 p-0 text-xs"
                    style={{ listStyle: "none", marginInlineStart: 0 }}
                  >
                    {component.capacityScenarios.map((scenario) => (
                      <li key={scenario.name}>
                        {scenarioLabel(scenario.name)}: {scenario.status}{" "}
                        {scenario.capacity === undefined
                          ? ""
                          : `(${scenario.capacity} seats)`}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={timingHeadingId}>
            <h4 className="font-semibold text-slate-950" id={timingHeadingId}>
              Timing, source, and model
            </h4>
            <dl className="mt-2 grid gap-2">
              <div>
                <dt>Normal Class enrollment starts</dt>
                <dd className="font-semibold text-slate-950">
                  {formatDate(result.term.enrollmentStart)}
                </dd>
              </div>
              <div>
                <dt>Add/drop ends</dt>
                <dd className="font-semibold text-slate-950">
                  {formatDate(result.term.addDropEnd)}
                </dd>
              </div>
              <div>
                <dt>Current observation</dt>
                <dd className="font-semibold text-slate-950">
                  {formatDate(result.sourceObservationTime)}
                </dd>
              </div>
              <div>
                <dt>Timing method</dt>
                <dd className="font-semibold text-slate-950">
                  Queue Activation uses the first positive wait observed after
                  normal Class enrollment starts; enrollment and add/drop dates
                  use the official Registry calendar.
                </dd>
              </div>
              <div>
                <dt>Source and model</dt>
                <dd className="break-words font-semibold text-slate-950">
                  <a href={result.term.source} rel="noreferrer" target="_blank">
                    Registry calendar
                  </a>{" "}
                  · {result.model.modelVersion} · {result.model.sourceArtifact}{" "}
                  · source revision {result.model.sourceRevision}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </details>
    </section>
  );
}

function WaitlistClassChoice({
  classItem,
  courseCode,
  positions,
  selected,
  onChange,
}: {
  classItem: WaitlistClass;
  courseCode: string;
  positions: Record<string, string>;
  selected: boolean;
  onChange(update: CardUpdate): void;
}) {
  const position = positions[classItem.section] ?? "";
  const error = selected ? positionError(classItem, position) : undefined;
  const inputId = `waitlist-position-${courseCode.replaceAll(" ", "-")}-${classItem.section}`;
  const checkboxId = `waitlist-class-${courseCode.replaceAll(" ", "-")}-${classItem.section}`;
  const schedules = classItem.schedules as WaitlistSchedule[];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_12rem] md:items-start md:gap-6">
        <Field orientation="horizontal" className="items-start gap-3">
          <Checkbox
            aria-label={`Require ${classItem.section}`}
            checked={selected}
            disabled={!classItem.eligible}
            id={checkboxId}
            onCheckedChange={(checked) =>
              onChange((current) => ({
                ...current,
                error: undefined,
                loading: false,
                positions: checked
                  ? current.positions
                  : Object.fromEntries(
                      Object.entries(current.positions).filter(
                        ([section]) => section !== classItem.section,
                      ),
                    ),
                result: undefined,
                selectedSections: checked
                  ? [...current.selectedSections, classItem.section]
                  : current.selectedSections.filter(
                      (section) => section !== classItem.section,
                    ),
                submittedKey: undefined,
              }))
            }
          />
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel className="text-base" htmlFor={checkboxId}>
              {classItem.section} ·{" "}
              {classItem.classType === "LEC"
                ? "Lecture"
                : classItem.classType === "TUT"
                  ? "Tutorial"
                  : classItem.classType === "LAB"
                    ? "Laboratory"
                    : "Independent"}
            </FieldLabel>
            <FieldDescription>
              {classItem.eligible
                ? "Supported for Waitlist Plans"
                : unsupportedLabel(classItem.unsupportedReason)}
            </FieldDescription>
          </div>
        </Field>
        <Field data-invalid={Boolean(error)} className="gap-2">
          <FieldLabel htmlFor={inputId}>Queue position</FieldLabel>
          <Input
            aria-describedby={error ? `${inputId}-error` : undefined}
            aria-invalid={Boolean(error)}
            aria-label={`Queue position for ${courseCode} ${classItem.section}`}
            autoComplete="off"
            disabled={!selected}
            id={inputId}
            name={inputId}
            inputMode="numeric"
            max={classItem.waitlist}
            min={1}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                error: undefined,
                loading: false,
                positions: {
                  ...current.positions,
                  [classItem.section]: event.target.value,
                },
                result: undefined,
                submittedKey: undefined,
              }))
            }
            placeholder={selected ? "e.g. 5…" : "Select Class first…"}
            step={1}
            type="number"
            value={position}
          />
          <FieldDescription>
            Current wait: {classItem.waitlist}
          </FieldDescription>
          {error ? (
            <FieldError id={`${inputId}-error`}>{error}</FieldError>
          ) : null}
        </Field>
      </div>
      <dl className="mt-4 grid gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm text-slate-700 sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-slate-950">Meeting</dt>
          <dd>{meetingLabel(schedules)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-950">Instructor</dt>
          <dd>{instructorLabel(schedules)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-950">
            Capacity / enrollment
          </dt>
          <dd>
            {classItem.capacity} / {classItem.enrollment}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-950">Wait</dt>
          <dd>{classItem.waitlist}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold text-slate-950">Reservations</dt>
          <dd>{reservationLabel(classItem)}</dd>
        </div>
        {classItem.observedAt ? (
          <div className="sm:col-span-2">
            <dt className="font-semibold text-slate-950">Observed</dt>
            <dd>{formatDate(classItem.observedAt)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function WaitlistCourseCard({
  offering,
  state,
  termCode,
  onUpdate,
}: {
  offering: WaitlistCourseOffering;
  state: CardState;
  termCode: string;
  onUpdate(update: CardUpdate): void;
}) {
  const selected = new Set(state.selectedSections);
  const selectedClasses = offering.classes.filter((item) =>
    selected.has(item.section),
  );
  const errors = Object.fromEntries(
    selectedClasses
      .map((item) => [
        item.section,
        positionError(item, state.positions[item.section] ?? ""),
      ])
      .filter(([, error]) => error !== undefined),
  );
  const canCalculate =
    selectedClasses.length > 0 && Object.keys(errors).length === 0;
  const calculate = () => {
    if (!selectedClasses.length) {
      onUpdate((current) => ({
        ...current,
        error: "Select at least one supported Class before calculating.",
      }));
      return;
    }
    if (!canCalculate) {
      onUpdate((current) => ({
        ...current,
        error: "Fix the highlighted queue positions before calculating.",
      }));
      return;
    }
    const input = {
      termCode,
      coursePrefix: offering.coursePrefix,
      courseNumber: offering.courseNumber,
      classes: selectedClasses.map((item) => ({
        section: item.section,
        position: Number(state.positions[item.section]),
      })),
    };
    const requestKey = JSON.stringify(input);
    onUpdate((current) => ({
      ...current,
      error: undefined,
      loading: true,
      result: undefined,
      submittedKey: requestKey,
    }));
    void queryWaitlistPlan(input).then(
      (result) => {
        onUpdate((current) => {
          if (current.submittedKey !== requestKey) return current;
          if (result.status === "supported")
            return { ...current, loading: false, result, error: undefined };
          return { ...current, loading: false, error: result.message };
        });
      },
      (error) =>
        onUpdate((current) => {
          if (current.submittedKey !== requestKey) return current;
          return {
            ...current,
            loading: false,
            error:
              error instanceof BrowserQueryError
                ? error.message
                : "Waitlist Evidence could not be calculated.",
          };
        }),
    );
  };
  return (
    <li data-waitlist-course={offering.courseCode}>
      <Card className="overflow-hidden bg-white">
        <Collapsible
          onOpenChange={(expanded) =>
            onUpdate((current) => ({ ...current, expanded }))
          }
          open={state.expanded}
        >
          <CardHeader className="gap-2 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <CardTitle asChild className="min-w-0 text-left">
                <h2>
                  <CollapsibleTrigger asChild>
                    <Button
                      aria-label={`${state.expanded ? "Collapse" : "Expand"} ${offering.courseCode}`}
                      className="h-auto max-w-full justify-start gap-2 whitespace-normal p-0 text-left text-xl font-bold hover:bg-transparent sm:text-2xl"
                      type="button"
                      variant="ghost"
                    >
                      <span className="wrap-break-word">
                        {offering.courseCode}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className="shrink-0 transition-transform data-[state=open]:rotate-180"
                      />
                    </Button>
                  </CollapsibleTrigger>
                </h2>
              </CardTitle>
              <Badge className="shrink-0" variant="outline">
                {offering.classes.filter((item) => item.eligible).length}{" "}
                supported
              </Badge>
            </div>
            <CardDescription>{offering.title}</CardDescription>
          </CardHeader>
          <CollapsibleContent>
            <Separator />
            <CardContent className="flex flex-col gap-5 p-4 sm:p-6">
              <p className="text-sm leading-relaxed text-slate-700">
                Select every Class required by this Course Offering and enter
                the queue position currently shown by SIS. The calculation
                applies AND semantics across your selected Classes.
              </p>
              <FieldSet className="gap-4">
                <FieldLegend>Required Classes</FieldLegend>
                <FieldDescription>
                  Section labels identify Classes but are not predictive
                  features.
                </FieldDescription>
                <FieldGroup className="gap-3">
                  <div className="flex flex-col gap-3">
                    {offering.classes.map((classItem) => (
                      <WaitlistClassChoice
                        classItem={classItem}
                        courseCode={offering.courseCode}
                        key={classItem.section}
                        onChange={onUpdate}
                        positions={state.positions}
                        selected={selected.has(classItem.section)}
                      />
                    ))}
                  </div>
                </FieldGroup>
              </FieldSet>
              {state.error ? (
                <Alert variant="destructive">
                  <h3 className="font-semibold">Plan not calculated</h3>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                disabled={
                  state.loading || (selectedClasses.length > 0 && !canCalculate)
                }
                onClick={calculate}
                type="button"
              >
                {state.loading ? <Spinner aria-hidden="true" /> : null}
                {state.loading
                  ? "Calculating…"
                  : "Calculate Historical Queue Evidence"}
              </Button>
              {state.result ? (
                <WaitlistEvidenceResult result={state.result} />
              ) : null}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </li>
  );
}

export function WaitlistPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const input = useMemo(() => ({ search: search || undefined }), [search]);
  const [state, setState] = useState<{
    error?: "invalid" | "unavailable";
    errorMessage?: string;
    key: string;
    loading: boolean;
    page?: WaitlistSearchResult;
  }>({ key: search, loading: true });
  const [cards, setCards] = useState<Record<string, CardState>>({});

  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, key: search, loading: true }));
    void queryWaitlistSearch(input).then(
      (page) => {
        if (current) setState({ key: search, loading: false, page });
      },
      (error) => {
        if (!current) return;
        const invalid =
          error instanceof BrowserQueryError && error.code === "invalid";
        setState({
          key: search,
          loading: false,
          error: invalid ? "invalid" : "unavailable",
          errorMessage:
            error instanceof BrowserQueryError ? error.message : undefined,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [input, search]);

  const current = state.key === search ? state : { ...state, loading: true };
  const page = current.page;
  function updateCard(courseCode: string, update: CardUpdate) {
    setCards((previous) => ({
      ...previous,
      [courseCode]: update(previous[courseCode] ?? newCardState()),
    }));
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-8 text-left lg:max-w-4xl">
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
          Waitlist Evidence
        </p>
        <h1 className="text-balance text-5xl font-black tracking-tight sm:text-6xl">
          Historical Queue Evidence
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty leading-relaxed text-slate-700">
          Compare aggregate queue movement for a required Waitlist Plan. This
          evidence does not estimate an individual student&apos;s enrollment
          outcome.
        </p>
      </header>
      <div className="flex flex-col gap-4">
        <div className="flex w-full items-center gap-4">
          <Field className="min-w-0 flex-1 gap-0">
            <FieldLabel className="sr-only" htmlFor="ranking-search">
              Search Waitlist Evidence Courses
            </FieldLabel>
            <RankingSearch entity="waitlist" initialValue={search} />
          </Field>
        </div>
        {page ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
            <p className="font-semibold">
              Current supported Term: {page.term.termName}
            </p>
            <p>
              {numberFormatter.format(page.total)} Course Offering
              {page.total === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}
      </div>
      {current.loading && !page ? (
        <Alert aria-label="Loading Waitlist Evidence Courses">
          <Spinner aria-hidden="true" />
          <AlertDescription>
            Loading current Waitlist Evidence Courses…
          </AlertDescription>
        </Alert>
      ) : current.error ? (
        <Alert variant="destructive">
          <h2 className="text-xl font-bold">
            Waitlist Evidence is unavailable
          </h2>
          <AlertDescription>
            {current.errorMessage ??
              "Public current-Term Schedule data could not be loaded. Refresh to try again."}
          </AlertDescription>
        </Alert>
      ) : page?.results.length ? (
        <ol
          aria-busy={current.loading}
          aria-label="Waitlist Evidence Course Offerings"
          className="flex list-none flex-col gap-3 p-0"
          style={{ listStyle: "none", marginInlineStart: 0 }}
        >
          {page.results.map((offering) => (
            <WaitlistCourseCard
              key={offering.courseCode}
              offering={offering}
              onUpdate={(update) => updateCard(offering.courseCode, update)}
              state={cards[offering.courseCode] ?? newCardState()}
              termCode={page.term.termCode}
            />
          ))}
        </ol>
      ) : (
        <Empty className="border bg-white">
          <EmptyHeader>
            <EmptyTitle>No Courses Found</EmptyTitle>
            <EmptyDescription>
              {search
                ? `No Course Offerings match “${search}”.`
                : "No current supported Course Offerings are available."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="sr-only" role="status">
        {current.loading
          ? "Updating Waitlist Evidence Courses…"
          : `Showing ${page?.results.length ?? 0} Waitlist Evidence Course Offerings.`}
      </p>
    </div>
  );
}
