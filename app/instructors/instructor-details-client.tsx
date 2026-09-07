"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import {
  ReviewComposer,
  type ReviewEditorOptions,
} from "@/app/courses/course-reviews";
import { DetailsRankings } from "@/app/courses/details-sections";
import { BrowserScheduleDetails } from "@/app/courses/schedule-client";
import {
  IdentityCard,
  InstructorDetails,
  type InstructorDetailsProps,
} from "@/app/instructors/instructor-details";
import {
  cachedInstructorDetails,
  cachedScheduleDetails,
  queryInstructorDetails,
  queryScheduleDetails,
} from "@/lib/browser-query/client";
import { rankingTermName } from "@/lib/rankings/presentation";
import type {
  InstructorIdentityLookup,
  Rankings,
  RankingsQuery,
} from "@/lib/rankings/server";
import type { ScheduleClass } from "@/lib/schedule/server";

export function BrowserInstructorDetails({
  instructorKey,
  rankingConfiguration,
  requestedTermCode,
  ...props
}: InstructorDetailsProps & {
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
  requestedTermCode?: string;
}) {
  const input = useMemo(
    () => ({
      key: instructorKey,
      termCode: requestedTermCode,
      ...rankingConfiguration,
    }),
    [instructorKey, rankingConfiguration, requestedTermCode],
  );
  const inputKey = JSON.stringify(input);
  const cached = cachedInstructorDetails(input);
  const [state, setState] = useState<{
    failed?: boolean;
    key: string;
    rankings?: Rankings;
  }>(() => ({ key: inputKey, rankings: cached }));
  useEffect(() => {
    let current = true;
    void queryInstructorDetails(input).then(
      (rankings) => {
        if (current)
          startTransition(() => setState({ key: inputKey, rankings }));
      },
      () => {
        if (current) setState({ failed: true, key: inputKey });
      },
    );
    return () => {
      current = false;
    };
  }, [input, inputKey]);
  const rankings =
    cached ?? (state.key === inputKey ? state.rankings : undefined);
  return (
    <InstructorDetails
      {...props}
      identity={rankings ?? props.identity}
      rankings={rankings ?? props.rankings}
      selectedTermCode={rankings?.population.termCode ?? props.selectedTermCode}
      termLoading={!rankings && !state.failed}
    />
  );
}

export function BrowserInstructorTeaching({
  fallbackIdentity,
  instructorKey,
  rankingConfiguration,
  requestedTermCode,
}: {
  fallbackIdentity: InstructorIdentityLookup;
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
  requestedTermCode?: string;
}) {
  const input = useMemo(
    () => ({
      key: instructorKey,
      termCode: requestedTermCode,
      ...rankingConfiguration,
    }),
    [instructorKey, rankingConfiguration, requestedTermCode],
  );
  const cached = cachedInstructorDetails(input);
  const [rankings, setRankings] = useState<Rankings | undefined>(cached);
  useEffect(() => {
    let current = true;
    void queryInstructorDetails(input).then(
      (value) => {
        if (current) startTransition(() => setRankings(value));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [input]);
  return (
    <BrowserScheduleDetails
      entity={{
        type: "instructor",
        uuids: (rankings ?? fallbackIdentity).familyUuids,
      }}
    />
  );
}

export function BrowserInstructorIdentity({
  fallbackIdentity,
  instructorKey,
  rankingConfiguration,
  requestedTermCode,
}: {
  fallbackIdentity: InstructorIdentityLookup;
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
  requestedTermCode?: string;
}) {
  const input = useMemo(
    () => ({
      key: instructorKey,
      termCode: requestedTermCode,
      ...rankingConfiguration,
    }),
    [instructorKey, rankingConfiguration, requestedTermCode],
  );
  const cached = cachedInstructorDetails(input);
  const [rankings, setRankings] = useState<Rankings | undefined>(cached);
  useEffect(() => {
    let current = true;
    void queryInstructorDetails(input).then(
      (value) => {
        if (current) startTransition(() => setRankings(value));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [input]);
  return (
    <IdentityCard identity={rankings ?? fallbackIdentity} rankings={rankings} />
  );
}

export function BrowserInstructorReviewComposer({
  classes,
  fallbackIdentity,
  instructorKey,
  rankingConfiguration,
  requestedTermCode,
  selectedTermCode,
}: {
  classes: ScheduleClass[];
  fallbackIdentity: InstructorIdentityLookup;
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
  requestedTermCode?: string;
  selectedTermCode?: string;
}) {
  const input = useMemo(
    () => ({
      key: instructorKey,
      termCode: requestedTermCode,
      ...rankingConfiguration,
    }),
    [instructorKey, rankingConfiguration, requestedTermCode],
  );
  const [rankings, setRankings] = useState<Rankings | undefined>(
    cachedInstructorDetails(input),
  );
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let current = true;
    setHydrated(true);
    void queryInstructorDetails(input).then(
      (value) => {
        if (current) startTransition(() => setRankings(value));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [input]);
  const identity = rankings ?? fallbackIdentity;
  const scheduleInput = useMemo(
    () => ({ type: "instructor" as const, uuids: identity.familyUuids }),
    [identity.familyUuids],
  );
  const [schedule, setSchedule] = useState(
    cachedScheduleDetails(scheduleInput),
  );
  useEffect(() => {
    let current = true;
    void queryScheduleDetails(scheduleInput).then(
      (value) => {
        if (current) setSchedule(value);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [scheduleInput]);
  const effectiveClasses =
    schedule?.type === "instructor" ? schedule.classes : classes;
  const courses = [
    ...new Set([
      ...(rankings?.courses.map((item) => item.courseCode) ?? []),
      ...effectiveClasses.map((item) => item.courseCode),
    ]),
  ].map((courseCode) => {
    const [coursePrefix = "", courseNumber = ""] = courseCode.split(" ");
    return { coursePrefix, courseNumber, label: courseCode };
  });
  const contextRows: ReviewEditorOptions["contexts"] = [
    ...(rankings?.terms.map((term) => ({
      instructorUuid: identity.instructor.uuid,
      termCode: term.termCode,
      termName: rankingTermName(term.termCode),
    })) ?? []),
    ...(rankings?.courses.map((association) => {
      const [coursePrefix = "", courseNumber = ""] =
        association.courseCode.split(" ");
      return {
        course: { coursePrefix, courseNumber },
        instructorUuid: identity.instructor.uuid,
        termCode: association.termCode,
        termName: rankingTermName(association.termCode),
      };
    }) ?? []),
    ...effectiveClasses.flatMap((item) => [
      {
        course: {
          coursePrefix: item.coursePrefix,
          courseNumber: item.courseNumber,
        },
        instructorUuid: identity.instructor.uuid,
        termCode: item.termCode,
        termName: rankingTermName(item.termCode),
      },
      {
        course: {
          coursePrefix: item.coursePrefix,
          courseNumber: item.courseNumber,
        },
        instructorUuid: identity.instructor.uuid,
        termCode: item.termCode,
        termName: rankingTermName(item.termCode),
        section: item.section,
      },
    ]),
  ];
  const contexts = [
    ...new Map(
      contextRows.map((context) => [JSON.stringify(context), context]),
    ).values(),
  ];
  const editor: ReviewEditorOptions = {
    courses,
    contexts,
    instructors: [
      {
        instructorUuid: identity.instructor.uuid,
        name: identity.instructor.canonicalName,
      },
    ],
  };
  return (
    <>
      <ReviewComposer
        {...editor}
        displayTermNames
        initialInstructorUuid={identity.instructor.uuid}
        initialTermCode={rankings?.population.termCode ?? selectedTermCode}
      />
      {hydrated && rankings ? (
        <span className="sr-only">
          Ranking Course–Instructor Review contexts: {rankings.courses.length}
        </span>
      ) : null}
    </>
  );
}

export function BrowserInstructorRankings({
  instructorKey,
  rankingConfiguration,
  requestedTermCode,
}: {
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
  requestedTermCode?: string;
}) {
  const input = useMemo(
    () => ({
      key: instructorKey,
      termCode: requestedTermCode,
      ...rankingConfiguration,
    }),
    [instructorKey, rankingConfiguration, requestedTermCode],
  );
  const inputKey = JSON.stringify(input);
  const cached = cachedInstructorDetails(input);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    rankings?: Rankings;
  }>(() => ({ key: inputKey, loading: !cached, rankings: cached }));
  useEffect(() => {
    let current = true;
    const available = cachedInstructorDetails(input);
    setState((previous) => ({
      key: inputKey,
      loading: !available,
      rankings: available ?? previous.rankings,
    }));
    void queryInstructorDetails(input).then(
      (rankings) => {
        if (current)
          startTransition(() =>
            setState({ key: inputKey, loading: false, rankings }),
          );
      },
      () => {
        if (current)
          startTransition(() => setState({ key: inputKey, loading: false }));
      },
    );
    return () => {
      current = false;
    };
  }, [input, inputKey]);
  const current = state.key === inputKey ? state : { ...state, loading: true };
  return (
    <>
      {requestedTermCode &&
      current.rankings &&
      current.rankings.population.termCode !== requestedTermCode ? (
        <p
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="status"
        >
          The requested Term has no ranking evidence. Showing the latest
          available Term instead.
        </p>
      ) : null}
      <DetailsRankings
        loading={current.loading && !current.rankings}
        rankings={current.rankings}
        scoreDistribution={current.rankings?.scoreDistribution}
        selectedTermCode={current.rankings?.population.termCode}
      />
      {current.rankings ? (
        <p className="sr-only">
          Pinned Instructor identity family: {current.rankings.family.length} ·
          Course relations: {current.rankings.courses.length} · Historical
          identities: {current.rankings.historicalEvidence.length}
        </p>
      ) : null}
    </>
  );
}
