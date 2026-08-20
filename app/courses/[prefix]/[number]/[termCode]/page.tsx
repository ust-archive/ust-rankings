import { notFound } from "next/navigation";
import {
  CourseOfferingDetails,
  UnavailableDetail,
} from "@/app/courses/course-details";
import { loadCourseRankings } from "@/app/courses/data";
import { loadReviews } from "@/app/courses/review-data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import {
  getSchedule,
  InvalidScheduleQueryError,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

export default async function CourseOfferingPage({
  params,
  searchParams,
}: {
  params: Promise<{ prefix: string; number: string; termCode: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const query = await searchParams;
  const { coursePrefix, courseNumber, termCode } = normalizeCourseRoute(
    await params,
    query,
  );
  if (!termCode) notFound();
  try {
    const [offering, rankings, community] = await Promise.all([
      getSchedule({
        type: "course-offering",
        coursePrefix,
        courseNumber,
        termCode,
      }),
      loadCourseRankings(coursePrefix, courseNumber, termCode),
      loadReviews({
        type: "course",
        coursePrefix,
        courseNumber,
        termCode,
      }),
    ]);
    if (offering.type !== "course-offering") notFound();
    return (
      <CourseOfferingDetails
        offering={offering}
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
          entity="Course Offering"
          title={`${coursePrefix} ${courseNumber} · ${termCode}`}
        />
      );
    throw error;
  }
}
