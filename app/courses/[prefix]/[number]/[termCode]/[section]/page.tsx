import { notFound } from "next/navigation";
import { ClassDetails, UnavailableDetail } from "@/app/courses/course-details";
import { loadCourseRankings } from "@/app/courses/data";
import { loadReviews } from "@/app/courses/review-data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";
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
  const [query, route] = await Promise.all([searchParams, params]);
  const { coursePrefix, courseNumber, termCode, section } =
    normalizeCourseRoute(route, query);
  if (!termCode || !section) notFound();
  const rankingPreference = await readRankingPreferenceQuery();
  try {
    const [scheduleClass, rankings, community] = await Promise.all([
      getSchedule({
        type: "class",
        coursePrefix,
        courseNumber,
        termCode,
        section,
      }),
      loadCourseRankings(
        coursePrefix,
        courseNumber,
        termCode,
        rankingPreference,
      ),
      loadReviews({
        type: "course",
        coursePrefix,
        courseNumber,
        termCode,
        section,
      }),
    ]);
    if (scheduleClass.type !== "class") notFound();
    return (
      <ClassDetails
        scheduleClass={scheduleClass}
        rankings={rankings}
        reviews={community.reviews}
        reviewsUnavailable={community.unavailable}
      />
    );
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
