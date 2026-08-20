import { notFound } from "next/navigation";
import { ClassDetails, UnavailableDetail } from "@/app/courses/course-details";
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

export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{
    prefix: string;
    number: string;
    termCode: string;
    section: string;
  }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const query = await searchParams;
  const { coursePrefix, courseNumber, termCode, section } =
    normalizeCourseRoute(await params, query);
  if (!termCode || !section) notFound();
  try {
    const [scheduleClass, rankings] = await Promise.all([
      getSchedule({
        type: "class",
        coursePrefix,
        courseNumber,
        termCode,
        section,
      }),
      loadCourseRankings(coursePrefix, courseNumber, termCode),
    ]);
    if (scheduleClass.type !== "class") notFound();
    return <ClassDetails scheduleClass={scheduleClass} rankings={rankings} />;
  } catch (error) {
    if (error instanceof InvalidScheduleQueryError) notFound();
    if (error instanceof ScheduleUnavailableError)
      return (
        <UnavailableDetail
          entity="Class"
          title={`${coursePrefix} ${courseNumber} · ${section}`}
        />
      );
    throw error;
  }
}
