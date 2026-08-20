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
  const selectedTerm =
    typeof query.term === "string" && /^[0-9]{4}$/.test(query.term)
      ? query.term
      : undefined;
  const [rankings, scheduleResult] = await Promise.all([
    loadCourseRankings(coursePrefix, courseNumber),
    getSchedule({ type: "course", coursePrefix, courseNumber }).then(
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
    ),
  ]);
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
