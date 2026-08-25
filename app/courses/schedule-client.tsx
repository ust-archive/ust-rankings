"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReviewComposer,
  type ReviewEditorOptions,
} from "@/app/courses/course-reviews";
import { EntityLink } from "@/app/entity-navigation";
import { instructorPath } from "@/app/instructors/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cachedScheduleDetails,
  queryScheduleDetails,
} from "@/lib/browser-query/client";
import type { ScheduleDetails, ScheduleEntity } from "@/lib/schedule/server";
import { coursePath } from "./routes";

export function BrowserScheduleReviewComposer({
  coursePrefix,
  courseNumber,
  entity,
  initialSection,
  initialTermCode,
}: {
  coursePrefix: string;
  courseNumber: string;
  entity: ScheduleEntity;
  initialSection?: string;
  initialTermCode?: string;
}) {
  const input = useMemo(() => entity, [entity]);
  const [schedule, setSchedule] = useState<ScheduleDetails | undefined>(
    cachedScheduleDetails(input),
  );
  useEffect(() => {
    let current = true;
    void queryScheduleDetails(input).then(
      (value) => {
        if (current) setSchedule(value);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [input]);
  const offerings = schedule
    ? schedule.type === "course"
      ? schedule.offerings
      : schedule.type === "course-offering"
        ? [schedule]
        : schedule.type === "class"
          ? []
          : []
    : [];
  const classes =
    schedule?.type === "class"
      ? [schedule]
      : offerings.flatMap((offering) => offering.classes);
  const course = { coursePrefix, courseNumber };
  const instructors = [
    ...new Map(
      classes
        .flatMap((item) => item.meetings)
        .flatMap((meeting) => meeting.instructors)
        .flatMap((instructor) =>
          instructor.uuid
            ? [
                [
                  instructor.uuid,
                  {
                    instructorUuid: instructor.uuid,
                    name: instructor.sourceName,
                  },
                ] as const,
              ]
            : [],
        ),
    ).values(),
  ];
  const baseContexts: ReviewEditorOptions["contexts"] = [
    ...offerings.flatMap((offering) => [
      { course, termCode: offering.termCode, termName: offering.termName },
      ...offering.classes.map((item) => ({
        course,
        termCode: offering.termCode,
        termName: offering.termName,
        section: item.section,
      })),
    ]),
    ...(schedule?.type === "class"
      ? [
          {
            course,
            termCode: schedule.termCode,
            termName: schedule.termCode,
            section: schedule.section,
          },
        ]
      : []),
  ];
  const contexts = [
    ...baseContexts,
    ...instructors.flatMap((instructor) =>
      baseContexts.map((context) => ({
        ...context,
        instructorUuid: instructor.instructorUuid,
      })),
    ),
  ];
  const editor = { courses: [course], contexts, instructors };
  return (
    <ReviewComposer
      {...editor}
      displayTermNames
      initialCourse={course}
      initialSection={initialSection}
      initialTermCode={initialTermCode}
    />
  );
}

function ScheduleDetailsLoading({ title }: { title: string }) {
  return (
    <Card
      aria-label={`Loading ${title}`}
      className="animate-pulse"
      data-details-schedule-skeleton
      role="status"
    >
      <CardHeader>
        <div className="h-7 w-48 max-w-full rounded bg-slate-200" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-5 w-2/3 rounded bg-slate-100" />
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-4/5 rounded bg-slate-100" />
      </CardContent>
    </Card>
  );
}

export function BrowserScheduleDetails({ entity }: { entity: ScheduleEntity }) {
  const input = useMemo(() => entity, [entity]);
  const cached = cachedScheduleDetails(input);
  const [state, setState] = useState<{
    loading: boolean;
    schedule?: ScheduleDetails;
  }>(() => ({ loading: !cached, schedule: cached }));
  useEffect(() => {
    let current = true;
    void queryScheduleDetails(input).then(
      (schedule) => {
        if (current) setState({ loading: false, schedule });
      },
      () => {
        if (current) setState({ loading: false });
      },
    );
    return () => {
      current = false;
    };
  }, [input]);
  if (state.loading)
    return (
      <ScheduleDetailsLoading
        title={
          entity.type === "instructor"
            ? "Classes"
            : entity.type === "class"
              ? "Class Details"
              : "Offerings & Classes"
        }
      />
    );
  if (!state.schedule)
    return (
      <Alert>
        <h2 className="font-bold">Schedule is unavailable</h2>
        <AlertDescription>
          Rankings and Community remain available.
        </AlertDescription>
      </Alert>
    );
  if (state.schedule.type === "instructor")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Classes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.schedule.classes.length ? (
            state.schedule.classes.map((item) => (
              <section
                className="text-sm"
                key={`${item.termCode}-${item.classNumber}`}
              >
                <EntityLink
                  className="font-semibold"
                  href={coursePath(
                    item.coursePrefix,
                    item.courseNumber,
                    item.termCode,
                    item.section,
                  )}
                >
                  {item.courseCode} {item.section} ({item.classNumber})
                </EntityLink>
                <p className="text-slate-600">
                  {item.enrollment}/{item.capacity} enrolled
                </p>
              </section>
            ))
          ) : (
            <p className="text-sm text-slate-600">No Classes are reported.</p>
          )}
        </CardContent>
      </Card>
    );
  const offerings =
    state.schedule.type === "course"
      ? state.schedule.offerings
      : state.schedule.type === "course-offering"
        ? [state.schedule]
        : [];
  if (offerings.length)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Offerings &amp; Classes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {offerings.map((offering) => (
            <section className="flex flex-col gap-2" key={offering.termCode}>
              <h3 className="font-semibold">
                <EntityLink
                  href={coursePath(
                    offering.coursePrefix,
                    offering.courseNumber,
                    offering.termCode,
                  )}
                >
                  {offering.termName}
                </EntityLink>
              </h3>
              <p className="text-sm text-slate-600">
                {offering.title} · {offering.credits} credits
              </p>
              {[
                offering.previousCourseCodes,
                offering.prerequisite,
                offering.corequisite,
                offering.exclusion,
              ].filter(Boolean).length ? (
                <p className="text-xs text-slate-600">
                  {[
                    offering.previousCourseCodes,
                    offering.prerequisite,
                    offering.corequisite,
                    offering.exclusion,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {offering.classes.map((item) => (
                <div
                  className="flex flex-col gap-1 text-sm"
                  key={item.classNumber}
                >
                  <EntityLink
                    className="font-medium"
                    href={coursePath(
                      item.coursePrefix,
                      item.courseNumber,
                      item.termCode,
                      item.section,
                    )}
                  >
                    {item.courseCode} {item.section} ({item.classNumber})
                  </EntityLink>
                  {[
                    ...new Map(
                      item.meetings
                        .flatMap((meeting) => meeting.instructors)
                        .map((instructor) => [
                          instructor.uuid ?? instructor.sourceName,
                          instructor,
                        ]),
                    ).values(),
                  ].map((instructor) =>
                    instructor.uuid ? (
                      <EntityLink
                        className="text-slate-700"
                        href={instructorPath(instructor.uuid)}
                        key={instructor.uuid}
                      >
                        {instructor.sourceName}
                      </EntityLink>
                    ) : (
                      <span key={instructor.sourceName}>
                        {instructor.sourceName}
                      </span>
                    ),
                  )}
                </div>
              ))}
            </section>
          ))}
        </CardContent>
      </Card>
    );
  if (state.schedule.type === "class")
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {state.schedule.courseCode} {state.schedule.section} (
            {state.schedule.classNumber})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p>
            {state.schedule.enrollment}/{state.schedule.capacity} enrolled ·{" "}
            {state.schedule.waitlist} waitlisted · {state.schedule.classType} ·{" "}
            {state.schedule.open ? "Open" : "Closed"}
          </p>
          {state.schedule.meetings.map((meeting) => (
            <p key={JSON.stringify(meeting)}>
              {meeting.weekday} {meeting.timeFrom ?? "TBA"}–
              {meeting.timeTo ?? "TBA"} · {meeting.room || "Room TBA"}
              {meeting.roomCode ? ` (${meeting.roomCode})` : ""} ·{" "}
              {meeting.dateFrom ?? "Dates TBA"}
              {meeting.dateTo ? `–${meeting.dateTo}` : ""}
            </p>
          ))}
          {state.schedule.meetings
            .flatMap((meeting) => meeting.instructors)
            .map((instructor) =>
              instructor.uuid ? (
                <EntityLink
                  href={instructorPath(instructor.uuid)}
                  key={`${instructor.uuid}-${instructor.sourceName}`}
                >
                  {instructor.sourceName}
                </EntityLink>
              ) : (
                <span key={instructor.sourceName}>{instructor.sourceName}</span>
              ),
            )}
          {state.schedule.reservations.map((reservation) => (
            <p key={reservation.name}>
              {reservation.name}: {reservation.enrollment}/{reservation.quota}
            </p>
          ))}
        </CardContent>
      </Card>
    );
  return null;
}
