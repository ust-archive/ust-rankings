"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { DetailsRankings } from "@/app/courses/details-sections";
import { IdentityCard } from "@/app/instructors/instructor-details";
import {
  cachedInstructorDetails,
  queryInstructorDetails,
} from "@/lib/browser-query/client";
import type {
  InstructorIdentityLookup,
  Rankings,
  RankingsQuery,
} from "@/lib/rankings/server";

export function BrowserInstructorIdentity({
  fallbackIdentity,
  instructorKey,
  rankingConfiguration,
}: {
  fallbackIdentity: InstructorIdentityLookup;
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
}) {
  const input = useMemo(
    () => ({ key: instructorKey, ...rankingConfiguration }),
    [instructorKey, rankingConfiguration],
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

export function BrowserInstructorRankings({
  instructorKey,
  rankingConfiguration,
  selectedTermCode,
}: {
  instructorKey: string;
  rankingConfiguration: {
    preset?: "learning" | "grade";
    weights?: RankingsQuery["weights"];
  };
  selectedTermCode?: string;
}) {
  const input = useMemo(
    () => ({
      key: instructorKey,
      termCode: selectedTermCode,
      ...rankingConfiguration,
    }),
    [instructorKey, rankingConfiguration, selectedTermCode],
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
      <DetailsRankings
        loading={current.loading && !current.rankings}
        rankings={current.rankings}
        scoreDistribution={current.rankings?.scoreDistribution}
        selectedTermCode={
          current.rankings?.population.termCode ?? selectedTermCode
        }
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
