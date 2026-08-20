import { notFound } from "next/navigation";
import { CourseDetails } from "@/app/courses/course-details";
import { loadCourseRankings } from "@/app/courses/data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import {
  getSchedule,
  InvalidScheduleQueryError,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ prefix: string; number: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const query = await searchParams;
  const { coursePrefix, courseNumber } = normalizeCourseRoute(
    await params,
    query,
  );
  const scheduleResult = await getSchedule({
    type: "course",
    coursePrefix,
    courseNumber,
  }).then(
    (schedule) => ({
      schedule: schedule.type === "course" ? schedule : undefined,
      unavailable: false as const,
    }),
    (error) => {
      if (error instanceof ScheduleUnavailableError)
        return { schedule: undefined, unavailable: true as const };
      if (error instanceof InvalidScheduleQueryError)
        return { schedule: undefined, unavailable: false as const };
      throw error;
    },
  );
  const selectedTerm =
    typeof query.term === "string" && /^[0-9]{4}$/.test(query.term)
      ? query.term
      : scheduleResult.schedule?.offerings.at(-1)?.termCode;
  const rankings = await loadCourseRankings(
    coursePrefix,
    courseNumber,
    selectedTerm,
  );
  if (!rankings && !scheduleResult.schedule && !scheduleResult.unavailable)
    notFound();

  return (
    <CourseDetails
      coursePrefix={coursePrefix}
      courseNumber={courseNumber}
      rankings={rankings}
      schedule={scheduleResult.schedule}
      selectedTermCode={selectedTerm}
    />
  );
}
