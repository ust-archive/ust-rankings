"use client";

import { Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { RankingSearch } from "@/app/rankings/ranking-search";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("en-HK", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Hong_Kong",
});
const numberFormatter = new Intl.NumberFormat("en");
const waitlistPageSize = 24;
const waitlistSkeletonCards = [0, 1, 2];
const waitlistSkeletonRows = [0, 1, 2, 3, 4];
const waitlistSkeletonColumns = [0, 1, 2, 3, 4, 5];

type SupportedPlan = Extract<WaitlistPlanResult, { status: "supported" }>;
type CardState = {
  loading: boolean;
  positions: Record<string, string>;
  result?: SupportedPlan;
  selectedSections: string[];
  submittedKey?: string;
  touchedSections: string[];
  error?: string;
};
type CardUpdate = (current: CardState) => CardState;

type WaitlistSchedule = Record<string, unknown>;

function newCardState(): CardState {
  return {
    loading: false,
    positions: {},
    selectedSections: [],
    touchedSections: [],
  };
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function scheduleText(item: WaitlistSchedule, key: string) {
  return stringValue(item[key]).trim();
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

function meetingDetails(schedules: readonly WaitlistSchedule[]) {
  if (!schedules.length) return [{ time: "No meeting published", venue: "" }];
  return schedules.map((meeting) => ({
    time: [
      scheduleText(meeting, "weekday"),
      [scheduleTime(meeting, "time_from"), scheduleTime(meeting, "time_to")]
        .filter(Boolean)
        .join("–"),
    ]
      .filter(Boolean)
      .join(" "),
    venue:
      scheduleText(meeting, "venue_name") || scheduleText(meeting, "venue"),
  }));
}

function availableSeats(
  classItem: Pick<WaitlistClass, "capacity" | "enrollment">,
) {
  return Math.max(0, classItem.capacity - classItem.enrollment);
}

function instructorLabel(schedules: readonly WaitlistSchedule[]) {
  const names = [
    ...new Set(
      schedules.flatMap((meeting) =>
        Array.isArray(meeting.instructors)
          ? meeting.instructors
              .map((value) => stringValue(value).trim())
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
        )}/${numberFormatter.format(reservation.quota)} enrol`,
    )
    .join("; ");
}

function unsupportedLabel(reason?: WaitlistUnsupportedReason) {
  switch (reason) {
    case "consent-required":
      return "Consent required before this evidence can be shown.";
    case "inactive":
      return "Section is inactive in the current term.";
    case "non-waitlisted":
      return "No wait is currently reported for this section.";
    case "missing-date":
      return "Observation date is missing.";
    case "missing-activation":
      return "Waitlist activation was not observed after enrol opened.";
    default:
      return "This section cannot be used in a Waitlist Plan.";
  }
}

function positionError(classItem: WaitlistClass, value: string) {
  if (!value.trim()) return "Enter a positive WL position.";
  if (!/^\d+$/.test(value)) return "WL position must be a positive integer.";
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position <= 0)
    return "WL position must be a positive integer.";
  if (position > classItem.waitlist)
    return `WL position cannot exceed the current wait of ${classItem.waitlist}.`;
  return undefined;
}

function waitlistPositionInputId(courseCode: string, section: string) {
  return `waitlist-position-${courseCode.replaceAll(" ", "-")}-${section}`;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function pp(value: number) {
  return `${Math.round(value * 100)} pp`;
}

function DetailItem({
  title,
  value,
  description,
  className,
  valueClassName,
}: {
  title: string;
  value: ReactNode;
  description: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50/60 p-3",
        className,
      )}
    >
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </dt>
      <dd className={cn("font-semibold text-slate-950", valueClassName)}>
        {value}
      </dd>
      <dd className="text-xs leading-relaxed text-slate-600">{description}</dd>
    </div>
  );
}

function formatAverage(value: number | undefined) {
  return value === undefined ? "not available" : value.toFixed(1);
}

function scenarioLabel(name: "current" | "venue" | "historical-large") {
  switch (name) {
    case "current":
      return "Current Section Capacity";
    case "venue":
      return "Current Room Capacity";
    case "historical-large":
      return "Larger Historical Venue";
  }
}

function scenarioDescription(name: "current" | "venue" | "historical-large") {
  switch (name) {
    case "current":
      return "Capacity reported for this section now.";
    case "venue":
      return "Capacity associated with the section's current room.";
    case "historical-large":
      return "Whether a larger-venue historical comparison was available.";
  }
}

function averageWithUnit(value: number | undefined, unit: string) {
  return value === undefined
    ? "Not available"
    : `${formatAverage(value)} ${unit}`;
}

function WaitlistEvidenceResult({ result }: { result: SupportedPlan }) {
  const idPrefix = `waitlist-${result.course.replaceAll(" ", "-").toLowerCase()}`;
  const detailsHeadingId = `${idPrefix}-details-heading`;
  const componentsHeadingId = `${idPrefix}-components-heading`;
  const timingHeadingId = `${idPrefix}-timing-heading`;
  return (
    <section
      aria-label="WL Compass result"
      aria-live="polite"
      className="flex flex-col gap-5 text-sm text-slate-700"
    >
      <p className="m-0 bg-slate-50 px-4 py-3 text-base leading-relaxed text-slate-950 sm:px-5">
        The clearance rate is{" "}
        <strong className="font-bold tabular-nums">
          {`${percent(result.estimate)} ±${pp(result.margin)} (${percent(result.range.low)}–${percent(result.range.high)})`}
        </strong>
        .
      </p>
      <section
        aria-labelledby={detailsHeadingId}
        className="flex flex-col gap-4"
      >
        <h3
          className="text-base font-semibold text-slate-950"
          id={detailsHeadingId}
        >
          Details
        </h3>
        <section>
          <h4 className="font-semibold text-slate-950">
            Evidence and Smoothing
          </h4>
          <dl className="mt-2 grid gap-4 sm:grid-cols-2">
            <DetailItem
              title="Exact Historical Samples"
              value={`${numberFormatter.format(result.exactHistoryCount)} samples`}
              description="Direct historical matches for this course, section pattern, term, and timing."
            />
            <DetailItem
              title="Fuzzy Historical Samples"
              value={`${numberFormatter.format(result.broaderHistoryCount)} samples`}
              description="Broader historical matches used when exact history is limited."
            />
            <DetailItem
              title="Prior Influence"
              value={percent(result.prior.influence)}
              description="How much the smoothing prior contributes to the estimate."
            />
            <DetailItem
              title="Joint Outcome"
              value={`${result.joint.successes}/${result.joint.samples} offerings`}
              description="Historical offerings where every required section cleared the requested position."
            />
            <DetailItem
              className="sm:col-span-2"
              title="Smoothing Formula"
              value={`(${result.smoothing.successes} + ${result.smoothing.priorWeight} × ${result.smoothing.priorRate.toFixed(3)}) ÷ (${result.smoothing.exactSamples} + ${result.smoothing.priorWeight}) = ${result.smoothing.estimate.toFixed(3)}`}
              valueClassName="break-words font-mono text-xs"
              description="Combines exact historical outcomes with the prior; the margin is a bounded uncertainty estimate, not a confidence interval."
            />
          </dl>
        </section>

        <section
          aria-labelledby={componentsHeadingId}
          className="border-t border-slate-200 pt-4"
        >
          <h4 className="font-semibold text-slate-950" id={componentsHeadingId}>
            Per-Section Evidence
          </h4>
          <ul
            className="mt-2 flex list-none flex-col divide-y divide-slate-200 p-0"
            style={{ listStyle: "none", marginInlineStart: 0 }}
          >
            {result.components.map((component) => (
              <li className="py-4 first:pt-0 last:pb-0" key={component.section}>
                <p className="font-semibold text-slate-950">
                  {component.section} · {component.type} · position{" "}
                  {component.position}
                </p>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                  <DetailItem
                    title="Historical Clearance"
                    value={`${component.historical.successes}/${component.historical.samples} offerings`}
                    description="Historical offerings where this section cleared the requested position."
                  />
                  <DetailItem
                    title="Average Net Reduction"
                    value={averageWithUnit(
                      component.historical.averageNetReduction,
                      "positions",
                    )}
                    description="Average decrease in queue position after activation."
                  />
                  <DetailItem
                    title="Average Gross Exits"
                    value={averageWithUnit(
                      component.historical.averageGrossExits,
                      "exits",
                    )}
                    description="Average number of people leaving the queue after activation."
                  />
                  <DetailItem
                    title="Observed Net Reduction"
                    value={
                      component.historical.minimumNetReduction === undefined
                        ? "Not available"
                        : `${component.historical.minimumNetReduction}–${component.historical.maximumNetReduction} positions`
                    }
                    description="Smallest to largest net reduction observed in matching offerings."
                  />
                  <DetailItem
                    title="Queue Activation"
                    value={
                      component.activationAt
                        ? formatDate(component.activationAt)
                        : "Not observed"
                    }
                    description={
                      component.activationHours === undefined
                        ? "When the waitlist first became active after enrol opened."
                        : `When the waitlist first became active: ${component.activationHours.toFixed(1)} hours after enrol opened.`
                    }
                  />
                  <DetailItem
                    title="Current Enrollment"
                    value={`${component.current.enrollment}/${component.current.capacity}`}
                    description="Currently enrolled students / section capacity."
                  />
                  <DetailItem
                    title="Current Wait"
                    value={`${component.current.waitlist} students`}
                    description="Students currently waiting for this section."
                  />
                  <DetailItem
                    title="Reservations"
                    value={reservationLabel({
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
                    description="Reserved-quota enrolment / quota reported for this section."
                  />
                </dl>
                <h5 className="mt-4 font-semibold text-slate-950">
                  Capacity Scenarios
                </h5>
                <dl className="mt-2 grid gap-4 sm:grid-cols-3">
                  {component.capacityScenarios.map((scenario) => (
                    <DetailItem
                      key={scenario.name}
                      title={scenarioLabel(scenario.name)}
                      value={
                        scenario.capacity === undefined
                          ? "Unknown"
                          : `${scenario.capacity} seats`
                      }
                      description={scenarioDescription(scenario.name)}
                    />
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby={timingHeadingId}
          className="border-t border-slate-200 pt-4"
        >
          <h4 className="font-semibold text-slate-950" id={timingHeadingId}>
            Timing
          </h4>
          <dl className="mt-2 grid gap-4 sm:grid-cols-2">
            <DetailItem
              title="Enrol Starts"
              value={formatDate(result.term.enrollmentStart)}
              description="Official start of enrolment."
            />
            <DetailItem
              title="Enrol Ends"
              value={formatDate(result.term.addDropEnd)}
              description="Official end of enrolment and add/drop."
            />
            <DetailItem
              title="Current Observation"
              value={formatDate(result.sourceObservationTime)}
              description="Timestamp of the current waitlist snapshot."
            />
          </dl>
        </section>
      </section>
    </section>
  );
}

function WaitlistClassChoice({
  calculating,
  classItem,
  courseCode,
  positions,
  selected,
  onChange,
  showError,
}: {
  calculating: boolean;
  classItem: WaitlistClass;
  courseCode: string;
  positions: Record<string, string>;
  selected: boolean;
  showError: boolean;
  onChange(update: CardUpdate): void;
}) {
  const position = positions[classItem.section] ?? "";
  const error =
    selected && showError ? positionError(classItem, position) : undefined;
  const inputId = waitlistPositionInputId(courseCode, classItem.section);
  const schedules = classItem.schedules as WaitlistSchedule[];
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const toggleSelection = () =>
    onChange((current) => {
      const checked = !selected;
      return {
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
        touchedSections: checked
          ? current.touchedSections
          : current.touchedSections.filter(
              (section) => section !== classItem.section,
            ),
      };
    });
  return (
    <tr
      className={cn(
        "text-sm transition-colors hover:bg-slate-50",
        selected && "bg-slate-50",
      )}
    >
      <td className="border border-slate-200 p-1 align-middle">
        <button
          aria-label={`Require ${classItem.section}`}
          aria-pressed={selected}
          className={cn(
            "min-h-12 w-full rounded-md border px-0.5 py-2 text-center font-mono text-xs leading-tight tabular-nums transition-colors sm:px-3 sm:text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2",
            selected
              ? "border-slate-950 bg-slate-950 text-white"
              : "border-slate-200 bg-slate-50 text-slate-950 hover:border-slate-400 hover:bg-slate-100",
            !classItem.eligible && "cursor-not-allowed opacity-60",
          )}
          disabled={!classItem.eligible}
          onClick={toggleSelection}
          type="button"
        >
          {classItem.section} ({classItem.classNumber})
        </button>
      </td>
      {classItem.eligible ? (
        <>
          <td className="border border-slate-200 px-0.5 py-2 text-center font-mono text-xs tabular-nums sm:px-2 sm:text-sm">
            {numberFormatter.format(classItem.capacity)}
          </td>
          <td className="border border-slate-200 px-0.5 py-2 text-center font-mono text-xs tabular-nums sm:px-2 sm:text-sm">
            {numberFormatter.format(availableSeats(classItem))}
          </td>
          <td className="border border-slate-200 px-0.5 py-2 text-center font-mono text-xs tabular-nums sm:px-2 sm:text-sm">
            {numberFormatter.format(classItem.waitlist)}
          </td>
          <td className="border border-slate-200 p-1 text-center align-middle">
            {selected ? (
              <Field data-invalid={Boolean(error)} className="min-w-0 gap-1">
                <FieldLabel className="sr-only" htmlFor={inputId}>
                  WL position
                </FieldLabel>
                <Input
                  aria-invalid={Boolean(error)}
                  aria-label={`WL Position for ${courseCode} ${classItem.section}`}
                  autoComplete="off"
                  data-loading={calculating ? "true" : undefined}
                  className="waitlist-position-input h-9 min-w-0 appearance-none border-slate-200 bg-white px-2 text-center font-mono text-xs tabular-nums shadow-none focus-visible:ring-1 focus-visible:ring-slate-400 focus-visible:ring-offset-0 aria-invalid:border-red-700 aria-invalid:text-red-700 aria-invalid:focus-visible:ring-red-700 sm:px-3 sm:text-sm"
                  id={inputId}
                  inputMode="numeric"
                  max={classItem.waitlist}
                  min={1}
                  name={inputId}
                  onBlur={() =>
                    onChange((current) => ({
                      ...current,
                      touchedSections: current.touchedSections.includes(
                        classItem.section,
                      )
                        ? current.touchedSections
                        : [...current.touchedSections, classItem.section],
                    }))
                  }
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
                      touchedSections: current.touchedSections.includes(
                        classItem.section,
                      )
                        ? current.touchedSections
                        : [...current.touchedSections, classItem.section],
                    }))
                  }
                  placeholder="-"
                  step={1}
                  type="number"
                  value={position}
                />
              </Field>
            ) : (
              <span aria-hidden="true" className="text-slate-400">
                -
              </span>
            )}
          </td>
        </>
      ) : (
        <td
          className="border border-slate-200 px-2 py-2 text-left text-xs text-slate-600"
          colSpan={4}
        >
          {unsupportedLabel(classItem.unsupportedReason)}
        </td>
      )}
      <td className="border border-slate-200 p-1 text-center align-middle">
        <Tooltip onOpenChange={setTooltipOpen} open={tooltipOpen}>
          <TooltipTrigger asChild>
            <Button
              aria-expanded={tooltipOpen}
              aria-label={`More details for ${courseCode} ${classItem.section}`}
              className="size-9 text-slate-600"
              onClick={() => setTooltipOpen((open) => !open)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Info aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>

          <TooltipContent
            className="w-max max-w-[calc(100vw-2rem)] p-4"
            side="top"
          >
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-sm">
              <dt className="font-semibold text-slate-950">Section</dt>
              <dd className="font-medium tabular-nums">
                {classItem.section} · {classItem.classType} ·{" "}
                {classItem.classNumber}
              </dd>
              <dt className="font-semibold text-slate-950">Instructor</dt>
              <dd className="break-words">{instructorLabel(schedules)}</dd>
              <dt className="self-start font-semibold text-slate-950">
                Schedule
              </dt>
              <dd className="flex min-w-0 flex-col gap-2">
                {meetingDetails(schedules).map((meeting) => (
                  <span
                    className="flex min-w-0 flex-col"
                    key={`${meeting.time}-${meeting.venue}`}
                  >
                    <span className="tabular-nums">
                      {meeting.time || "Time not published"}
                    </span>
                    {meeting.venue ? (
                      <span className="break-words text-slate-600">
                        {meeting.venue}
                      </span>
                    ) : null}
                  </span>
                ))}
              </dd>
              <dt className="font-semibold text-slate-950">Quota</dt>
              <dd className="font-medium tabular-nums">
                {numberFormatter.format(classItem.capacity)}
              </dd>
              <dt className="font-semibold text-slate-950">Avail</dt>
              <dd className="font-medium tabular-nums">
                {numberFormatter.format(availableSeats(classItem))}
              </dd>
              <dt className="font-semibold text-slate-950">Wait</dt>
              <dd className="font-medium tabular-nums">
                {numberFormatter.format(classItem.waitlist)}
              </dd>
              <dt className="font-semibold text-slate-950">Reservations</dt>
              <dd className="min-w-0 break-words">
                {reservationLabel(classItem)}
              </dd>
              {classItem.observedAt ? (
                <>
                  <dt className="font-semibold text-slate-950">Observed</dt>
                  <dd>{formatDate(classItem.observedAt)}</dd>
                </>
              ) : null}
            </dl>
          </TooltipContent>
        </Tooltip>
      </td>
    </tr>
  );
}

function WaitlistCardSkeletons() {
  return (
    <div
      aria-label="Loading WL Compass Courses"
      className="flex flex-col gap-6"
      role="status"
    >
      {waitlistSkeletonCards.map((card) => (
        <Card
          aria-hidden="true"
          className="animate-pulse overflow-hidden border-slate-300 bg-white shadow-sm motion-reduce:animate-none"
          data-waitlist-card-skeleton
          key={card}
        >
          <CardHeader className="gap-1.5 p-4 sm:p-6">
            <div className="h-7 w-32 rounded bg-slate-200" />
            <div className="h-4 w-56 max-w-full rounded bg-slate-100" />
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50">
              <div className="w-full">
                <div className="grid grid-cols-[30%_12%_12%_12%_20%_14%]">
                  {waitlistSkeletonColumns.map((column) => (
                    <div
                      className="h-10 border border-slate-200 bg-slate-100"
                      key={column}
                    />
                  ))}
                </div>
                {waitlistSkeletonRows.map((row) => (
                  <div
                    className="grid grid-cols-[30%_12%_12%_12%_20%_14%]"
                    key={row}
                  >
                    {waitlistSkeletonColumns.map((column) => (
                      <div className="border border-slate-200 p-1" key={column}>
                        <div className="h-8 rounded bg-slate-100" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
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
  const planInput = useMemo(() => {
    if (!canCalculate) return undefined;
    const classes = offering.classes.filter((item) =>
      state.selectedSections.includes(item.section),
    );
    return {
      termCode,
      coursePrefix: offering.coursePrefix,
      courseNumber: offering.courseNumber,
      classes: classes.map((item) => ({
        section: item.section,
        position: Number(state.positions[item.section]),
      })),
    };
  }, [
    canCalculate,
    offering.classes,
    offering.courseNumber,
    offering.coursePrefix,
    state.positions,
    state.selectedSections,
    termCode,
  ]);
  const planKey = planInput ? JSON.stringify(planInput) : undefined;
  const calculating =
    state.loading || (planKey !== undefined && state.submittedKey !== planKey);
  const runPlan = useCallback(
    (input: NonNullable<typeof planInput>, requestKey: string) => {
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
                  : "WL Compass could not be calculated.",
            };
          }),
      );
    },
    [onUpdate],
  );
  useEffect(() => {
    if (!planInput || !planKey || state.submittedKey === planKey) return;
    runPlan(planInput, planKey);
  }, [planInput, planKey, runPlan, state.submittedKey]);
  const headingId = `waitlist-${offering.courseCode.replaceAll(" ", "-").toLowerCase()}-summary-heading`;
  return (
    <li className="min-w-0" data-waitlist-course={offering.courseCode}>
      <Card
        aria-busy={calculating}
        className="min-w-0 overflow-hidden border-slate-300 bg-white shadow-sm"
      >
        <CardHeader className="relative gap-1.5 p-4 sm:p-6">
          <div className="min-w-0 pr-10 sm:pr-12">
            <CardTitle asChild>
              <h2 className="wrap-break-word tracking-tight" id={headingId}>
                {offering.courseCode}
              </h2>
            </CardTitle>
            <CardDescription className="break-words text-pretty leading-relaxed">
              {offering.title}
            </CardDescription>
          </div>
          {calculating ? (
            <Spinner
              aria-label="Calculating WL Compass"
              className="absolute right-4 top-4 size-5 text-slate-600 sm:right-6 sm:top-6"
            />
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5 p-4 pt-0 sm:p-6 sm:pt-0">
          <section aria-label="Course components" className="min-w-0">
            <TooltipProvider delayDuration={300}>
              <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50">
                <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
                  <caption className="sr-only">
                    Select the course components you need and enter a WL
                    position for each selected component.
                  </caption>
                  <colgroup>
                    <col className="w-[28%] sm:w-[30%]" />
                    <col className="w-[13%] sm:w-[12%]" />
                    <col className="w-[13%] sm:w-[12%]" />
                    <col className="w-[13%] sm:w-[12%]" />
                    <col className="w-[19%] sm:w-[20%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead className="bg-slate-100">
                    <tr>
                      {[
                        "Section",
                        "Quota",
                        "Avail",
                        "Wait",
                        "Position",
                        "",
                      ].map((label) => (
                        <th
                          className="border border-slate-200 px-0.5 py-3 text-center font-mono text-xs font-semibold leading-tight sm:px-2 sm:text-sm"
                          key={label || "details"}
                          scope="col"
                        >
                          {label || <span className="sr-only">Details</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {offering.classes.map((classItem) => (
                      <WaitlistClassChoice
                        calculating={calculating}
                        classItem={classItem}
                        courseCode={offering.courseCode}
                        key={classItem.section}
                        onChange={onUpdate}
                        positions={state.positions}
                        selected={selected.has(classItem.section)}
                        showError={state.touchedSections.includes(
                          classItem.section,
                        )}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>
          </section>
          {state.error ? (
            <Alert variant="destructive">
              <h3 className="font-semibold">Plan not calculated</h3>
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          {state.result ? (
            <WaitlistEvidenceResult result={state.result} />
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

export function WaitlistPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const input = useMemo(
    () => ({
      limit: waitlistPageSize,
      offset: 0,
      search: search || undefined,
    }),
    [search],
  );
  const [state, setState] = useState<{
    error?: "invalid" | "unavailable";
    errorMessage?: string;
    key: string;
    loadMoreError?: string;
    loading: boolean;
    loadingMore: boolean;
    page?: WaitlistSearchResult;
  }>({ key: search, loading: true, loadingMore: false });
  const [cards, setCards] = useState<Record<string, CardState>>({});

  useEffect(() => {
    let current = true;
    setState({ key: search, loading: true, loadingMore: false });
    void queryWaitlistSearch(input).then(
      (page) => {
        if (current)
          setState({ key: search, loading: false, loadingMore: false, page });
      },
      (error) => {
        if (!current) return;
        const invalid =
          error instanceof BrowserQueryError && error.code === "invalid";
        setState({
          key: search,
          loading: false,
          loadingMore: false,
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
  function loadMore() {
    if (
      !page ||
      state.key !== search ||
      state.loadingMore ||
      page.results.length >= page.total
    )
      return;
    const offset = page.results.length;
    setState((previous) =>
      previous.key === search
        ? { ...previous, loadMoreError: undefined, loadingMore: true }
        : previous,
    );
    void queryWaitlistSearch({
      limit: waitlistPageSize,
      offset,
      search: search || undefined,
    }).then(
      (nextPage) =>
        setState((previous) => {
          if (previous.key !== search || !previous.page) return previous;
          const knownCourses = new Set(
            previous.page.results.map((item) => item.courseCode),
          );
          return {
            ...previous,
            loadMoreError: undefined,
            loadingMore: false,
            page: {
              ...nextPage,
              results: [
                ...previous.page.results,
                ...nextPage.results.filter(
                  (item) => !knownCourses.has(item.courseCode),
                ),
              ],
            },
          };
        }),
      (error) =>
        setState((previous) =>
          previous.key === search
            ? {
                ...previous,
                loadMoreError:
                  error instanceof BrowserQueryError
                    ? error.message
                    : "More WL Compass Course Offerings could not be loaded.",
                loadingMore: false,
              }
            : previous,
        ),
    );
  }
  function updateCard(courseCode: string, update: CardUpdate) {
    setCards((previous) => ({
      ...previous,
      [courseCode]: update(previous[courseCode] ?? newCardState()),
    }));
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8 text-left text-slate-900">
      <header className="text-center">
        <h1 className="text-logo-gradient text-balance text-5xl font-bold leading-none tracking-tighter sm:text-7xl">
          WL Compass
        </h1>
      </header>
      <div className="flex flex-col gap-4">
        <div className="flex w-full items-center gap-4">
          <Field className="min-w-0 flex-1 gap-0">
            <FieldLabel className="sr-only" htmlFor="ranking-search">
              Search WL Compass Courses
            </FieldLabel>
            <RankingSearch entity="waitlist" initialValue={search} />
          </Field>
        </div>
        {page ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-slate-700">
            <span>{page.term.termName}</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span className="tabular-nums">
              {numberFormatter.format(page.total)} Course Offering
              {page.total === 1 ? "" : "s"}
            </span>
          </p>
        ) : null}
      </div>
      {current.loading && !page ? (
        <WaitlistCardSkeletons />
      ) : current.error ? (
        <Alert variant="destructive">
          <h2 className="text-xl font-bold">WL Compass is unavailable</h2>
          <AlertDescription>
            {current.errorMessage ??
              "Public current-Term Schedule data could not be loaded. Refresh to try again."}
          </AlertDescription>
        </Alert>
      ) : page?.results.length ? (
        <>
          <ol
            aria-busy={current.loading || current.loadingMore}
            aria-label="WL Compass Course Offerings"
            className="flex list-none flex-col gap-6 p-0"
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
          {page.results.length < page.total ? (
            <div className="flex flex-col items-center gap-3">
              <Button
                aria-label="Load more WL Compass Course Offerings"
                className="min-w-32"
                disabled={current.loadingMore}
                onClick={loadMore}
                type="button"
                variant="outline"
              >
                {current.loadingMore ? <Spinner aria-hidden="true" /> : null}
                {current.loadingMore
                  ? "Loading…"
                  : `Load ${numberFormatter.format(
                      Math.min(
                        waitlistPageSize,
                        page.total - page.results.length,
                      ),
                    )} more`}
              </Button>
              {current.loadMoreError ? (
                <Alert variant="destructive">
                  <AlertDescription>{current.loadMoreError}</AlertDescription>
                </Alert>
              ) : null}
              <p className="text-sm text-slate-600" aria-live="polite">
                Showing {numberFormatter.format(page.results.length)} of{" "}
                {numberFormatter.format(page.total)} Course Offerings.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <Empty className="border border-slate-300 bg-white shadow-sm">
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
          ? "Updating WL Compass Courses…"
          : `Showing ${page?.results.length ?? 0} of ${page?.total ?? 0} WL Compass Course Offerings.`}
      </p>
    </div>
  );
}
