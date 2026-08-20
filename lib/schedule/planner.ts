export const MAX_PLANNER_CLASSES = 50;
export const MAX_SCHEDULE_SEARCH_LENGTH = 100;
export const MAX_SIS_TEXT_LENGTH = 50_000;

export type PlannerView = "browse" | "cart";
export type PlannerState = {
  termCode: string;
  search?: string;
  classNumbers: number[];
  view: PlannerView;
};

type SearchParams = Record<string, string | string[] | undefined>;

type ParsedPlannerQuery = Omit<PlannerState, "termCode"> & {
  termCode?: string;
  termInvalid: boolean;
  messages: string[];
};

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export function parsePlannerQuery(
  parameters: SearchParams,
): ParsedPlannerQuery {
  const messages: string[] = [];
  const rawTerm = one(parameters.term);
  const termInvalid =
    Array.isArray(parameters.term) ||
    Boolean(rawTerm && !/^[0-9]{4}$/.test(rawTerm));
  let termCode: string | undefined;
  if (Array.isArray(parameters.term))
    messages.push("Use exactly one Term Code.");
  else if (termInvalid)
    messages.push("Invalid Term Code; showing the latest Term.");
  else termCode = rawTerm;

  const rawSearch = one(parameters.q)?.trim();
  let search: string | undefined;
  if (Array.isArray(parameters.q))
    messages.push("Use exactly one search value.");
  else if (rawSearch && rawSearch.length > MAX_SCHEDULE_SEARCH_LENGTH)
    messages.push(
      `Search is limited to ${MAX_SCHEDULE_SEARCH_LENGTH} characters.`,
    );
  else search = rawSearch || undefined;

  const rawClasses = parameters.class
    ? Array.isArray(parameters.class)
      ? parameters.class
      : [parameters.class]
    : [];
  let classNumbers: number[] = [];
  if (rawClasses.length > MAX_PLANNER_CLASSES) {
    messages.push(`Select at most ${MAX_PLANNER_CLASSES} Classes.`);
  } else {
    for (const value of rawClasses) {
      if (!/^[1-9][0-9]{0,5}$/.test(value)) {
        messages.push(`Ignored invalid Class Number "${value.slice(0, 30)}".`);
        continue;
      }
      classNumbers.push(Number(value));
    }
    classNumbers = [...new Set(classNumbers)].sort(
      (left, right) => left - right,
    );
  }

  const rawView = one(parameters.view);
  let view: PlannerView = "browse";
  if (
    Array.isArray(parameters.view) ||
    (rawView && rawView !== "browse" && rawView !== "cart")
  )
    messages.push("Unknown Schedule view; showing Browse.");
  else if (rawView === "cart") view = "cart";

  return { termCode, search, classNumbers, view, termInvalid, messages };
}

export function mergePlannerClassNumbers(
  current: ReadonlyArray<number>,
  additions: ReadonlyArray<number>,
): { classNumbers: number[]; error?: string } {
  const classNumbers = [...new Set([...current, ...additions])].sort(
    (left, right) => left - right,
  );
  if (classNumbers.length > MAX_PLANNER_CLASSES)
    return {
      classNumbers: [...current],
      error: `The planner cart is limited to ${MAX_PLANNER_CLASSES} Classes.`,
    };
  return { classNumbers };
}

export function buildScheduleUrl(state: PlannerState) {
  const parameters = new URLSearchParams({ term: state.termCode });
  if (state.search) parameters.set("q", state.search);
  for (const classNumber of [...new Set(state.classNumbers)].sort(
    (left, right) => left - right,
  ))
    parameters.append("class", String(classNumber));
  parameters.set("view", state.view);
  return `/schedule?${parameters}`;
}

type ConflictClass = {
  classNumber: number;
  meetings: Array<{
    weekday: string;
    dateFrom?: string;
    dateTo?: string;
    timeFrom?: string;
    timeTo?: string;
  }>;
};

export function findPlannerConflicts(
  classes: ReadonlyArray<ConflictClass>,
): Array<readonly [number, number]> {
  const conflicts: Array<readonly [number, number]> = [];
  for (let leftIndex = 0; leftIndex < classes.length; leftIndex++) {
    const left = classes[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < classes.length;
      rightIndex++
    ) {
      const right = classes[rightIndex];
      if (
        right &&
        left.meetings.some((leftMeeting) =>
          right.meetings.some(
            (rightMeeting) =>
              leftMeeting.weekday === rightMeeting.weekday &&
              leftMeeting.dateFrom &&
              leftMeeting.dateTo &&
              rightMeeting.dateFrom &&
              rightMeeting.dateTo &&
              leftMeeting.dateFrom <= rightMeeting.dateTo &&
              rightMeeting.dateFrom <= leftMeeting.dateTo &&
              leftMeeting.timeFrom &&
              leftMeeting.timeTo &&
              rightMeeting.timeFrom &&
              rightMeeting.timeTo &&
              leftMeeting.timeFrom < rightMeeting.timeTo &&
              rightMeeting.timeFrom < leftMeeting.timeTo,
          ),
        )
      )
        conflicts.push([left.classNumber, right.classNumber]);
    }
  }
  return conflicts;
}

export function parseSisImport(text: string): {
  classNumbers: number[];
  message?: string;
} {
  if (text.length > MAX_SIS_TEXT_LENGTH)
    return {
      classNumbers: [],
      message: `SIS text is limited to ${MAX_SIS_TEXT_LENGTH.toLocaleString("en-US")} characters.`,
    };
  const classNumbers = [...text.matchAll(/^\w{3} \(([1-9][0-9]{0,5})\)$/gm)]
    .map((match) => Number(match[1]))
    .filter((number, index, values) => values.indexOf(number) === index)
    .sort((left, right) => left - right);
  if (classNumbers.length === 0)
    return {
      classNumbers,
      message: "No Class Numbers were found in the pasted SIS text.",
    };
  if (classNumbers.length > MAX_PLANNER_CLASSES)
    return {
      classNumbers: [],
      message: `SIS import is limited to ${MAX_PLANNER_CLASSES} Classes.`,
    };
  return { classNumbers };
}
