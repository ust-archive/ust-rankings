"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { DetailsRankings } from "@/app/courses/details-sections";
import {
  cachedCourseDetails,
  queryCourseDetails,
} from "@/lib/browser-query/client";
import type { CourseRankings, RankingsQuery } from "@/lib/rankings/server";

type RankingConfiguration = {
  preset?: "learning" | "grade";
  weights?: RankingsQuery["weights"];
};

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
