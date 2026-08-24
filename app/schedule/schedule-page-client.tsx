"use client";

import { useEffect, useMemo, useState } from "react";
import { coursePath } from "@/app/courses/routes";
import { EntityLink } from "@/app/entity-navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { querySchedulePage } from "@/lib/browser-query/client";
import type { SchedulePage } from "@/lib/schedule/server";

export function SchedulePageClient({
  search,
  termCode,
}: {
  search?: string;
  termCode?: string;
}) {
  const input = useMemo(() => ({ search, termCode }), [search, termCode]);
  const [page, setPage] = useState<SchedulePage>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void querySchedulePage(input).then(
      (value) => {
        if (current) setPage(value);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [input]);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 text-left">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
          Schedule
        </p>
        <h1 className="text-4xl font-black">Course Offerings</h1>
      </header>
      {!page && !failed ? (
        <Alert>
          <Spinner aria-hidden="true" />
          <AlertDescription>Loading Schedule…</AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert>
          <h2 className="font-bold">Schedule is unavailable</h2>
        </Alert>
      ) : null}
      {page ? (
        <>
          <p>
            {page.term.termName} · {page.total} Course Offerings
          </p>
          {page.results.map((offering) => (
            <Card key={`${offering.termCode}-${offering.courseCode}`}>
              <CardHeader>
                <CardTitle>
                  <EntityLink
                    href={coursePath(
                      offering.coursePrefix,
                      offering.courseNumber,
                      offering.termCode,
                    )}
                  >
                    {offering.courseCode} · {offering.title}
                  </EntityLink>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {offering.classes.length} Classes · {offering.credits} credits
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
