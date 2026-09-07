"use client";

import {
  type ComponentProps,
  startTransition,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CourseDetails } from "@/app/courses/course-details";
import { DetailsRankings } from "@/app/courses/details-sections";
import {
  cachedCourseDetails,
  cachedScheduleDetails,
  queryCourseDetails,
  queryScheduleDetails,
} from "@/lib/browser-query/client";
import type { CourseRankings, RankingsQuery } from "@/lib/rankings/server";

type RankingConfiguration = {
  preset?: "learning" | "grade";
  weights?: RankingsQuery["weights"];
};

type BrowserCourseDetailsProps = ComponentProps<typeof CourseDetails> & {
  rankingConfiguration: RankingConfiguration;
  requestedTermCode?: string;
};

export function BrowserCourseDetails({
  courseNumber,
  coursePrefix,
  rankingConfiguration,
  requestedTermCode,
  ...props
}: BrowserCourseDetailsProps) {
  const rankingInput = useMemo(
    () => ({
      coursePrefix,
      courseNumber,
      termCode: requestedTermCode,
      ...rankingConfiguration,
    }),
    [courseNumber, coursePrefix, rankingConfiguration, requestedTermCode],
  );
  const scheduleInput = useMemo(
    () => ({ type: "course" as const, coursePrefix, courseNumber }),
    [courseNumber, coursePrefix],
  );
  const rankingKey = JSON.stringify(rankingInput);
  const scheduleKey = JSON.stringify(scheduleInput);
  const cachedRankings = cachedCourseDetails(rankingInput);
  const cachedSchedule = cachedScheduleDetails(scheduleInput);
  const [rankingState, setRankingState] = useState<{
    failed?: boolean;
    key: string;
    rankings?: CourseRankings;
  }>({ key: rankingKey, rankings: cachedRankings });
  const [scheduleState, setScheduleState] = useState<{
    failed?: boolean;
    key: string;
    schedule?: ReturnType<typeof cachedScheduleDetails>;
  }>({ key: scheduleKey, schedule: cachedSchedule });

  useEffect(() => {
    let current = true;
    setRankingState({
      key: rankingKey,
      rankings: cachedCourseDetails(rankingInput),
    });
    void queryCourseDetails(rankingInput).then(
      (rankings) => {
        if (current)
          startTransition(() => setRankingState({ key: rankingKey, rankings }));
      },
      () => {
        if (current) setRankingState({ failed: true, key: rankingKey });
      },
    );
    return () => {
      current = false;
    };
  }, [rankingInput, rankingKey]);
  useEffect(() => {
    let current = true;
    setScheduleState({
      key: scheduleKey,
      schedule: cachedScheduleDetails(scheduleInput),
    });
    void queryScheduleDetails(scheduleInput).then(
      (schedule) => {
        if (current) setScheduleState({ key: scheduleKey, schedule });
      },
      () => {
        if (current) setScheduleState({ failed: true, key: scheduleKey });
      },
    );
    return () => {
      current = false;
    };
  }, [scheduleInput, scheduleKey]);
  const currentRankings =
    rankingState.key === rankingKey ? rankingState : { key: rankingKey };
  const currentSchedule =
    scheduleState.key === scheduleKey ? scheduleState : { key: scheduleKey };
  const rankings = currentRankings.rankings;
  const schedule = currentSchedule.schedule;

  return (
    <CourseDetails
      {...props}
      courseNumber={courseNumber}
      coursePrefix={coursePrefix}
      detailsLoading={
        !rankings &&
        schedule?.type !== "course" &&
        !(currentRankings.failed && currentSchedule.failed)
      }
      rankings={rankings}
      schedule={schedule?.type === "course" ? schedule : undefined}
      selectedTermCode={rankings?.population.termCode ?? requestedTermCode}
    />
  );
}

export function BrowserCourseRankings({
  coursePrefix,
  courseNumber,
  rankingConfiguration,
  selectedTermCode,
  termNames,
}: {
  coursePrefix: string;
  courseNumber: string;
  rankingConfiguration: RankingConfiguration;
  selectedTermCode?: string;
  termNames: Array<[string, string]>;
}) {
  const input = useMemo(
    () => ({
      coursePrefix,
      courseNumber,
      termCode: selectedTermCode,
      ...rankingConfiguration,
    }),
    [courseNumber, coursePrefix, rankingConfiguration, selectedTermCode],
  );
  const inputKey = JSON.stringify(input);
  const cached = cachedCourseDetails(input);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    rankings?: CourseRankings;
  }>(() => ({ key: inputKey, loading: !cached, rankings: cached }));
  useEffect(() => {
    let current = true;
    const available = cachedCourseDetails(input);
    setState((previous) => ({
      key: inputKey,
      loading: !available,
      rankings: available ?? previous.rankings,
    }));
    void queryCourseDetails(input).then(
      (rankings) => {
        if (current)
          startTransition(() => {
            setState({ key: inputKey, loading: false, rankings });
          });
      },
      () => {
        if (current)
          startTransition(() => {
            setState({ key: inputKey, loading: false });
          });
      },
    );
    return () => {
      current = false;
    };
  }, [input, inputKey]);
  const current = state.key === inputKey ? state : { ...state, loading: true };
  return (
    <>
      <DetailsRankings
        loading={current.loading && !current.rankings}
        rankings={current.rankings}
        scoreDistribution={current.rankings?.scoreDistribution}
        selectedTermCode={
          selectedTermCode ?? current.rankings?.population.termCode
        }
        termNames={new Map(termNames)}
      />
      {current.rankings ? (
        <p className="sr-only">
          Pinned Course–Instructor relations:{" "}
          {current.rankings.instructors.length}
        </p>
      ) : null}
    </>
  );
}
