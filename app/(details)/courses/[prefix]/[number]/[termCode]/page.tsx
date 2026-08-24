import { notFound } from "next/navigation";
import { CourseDetails } from "@/app/courses/course-details";
import { BrowserCourseRankings } from "@/app/courses/course-details-client";
import { loadReviews } from "@/app/courses/review-data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import { BrowserScheduleDetails } from "@/app/courses/schedule-client";
import { reviewOrder } from "@/lib/contributions/review-order";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";

export default async function CourseOfferingPage({
  params,
  searchParams,
}: {
  params: Promise<{ prefix: string; number: string; termCode: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const [query, route] = await Promise.all([searchParams, params]);
  const { coursePrefix, courseNumber, termCode } = normalizeCourseRoute(
    route,
    query,
  );
  if (!termCode) notFound();
  const [rankingPreference, community] = await Promise.all([
    readRankingPreferenceQuery(),
    loadReviews({
      type: "course",
      coursePrefix,
      courseNumber,
      termCode,
      order: reviewOrder(query.order),
    }),
  ]);
  return (
    <CourseDetails
      coursePrefix={coursePrefix}
      courseNumber={courseNumber}
      rankingsContent={
        <BrowserCourseRankings
          coursePrefix={coursePrefix}
          courseNumber={courseNumber}
          rankingConfiguration={rankingPreference}
          selectedTermCode={termCode}
          termNames={[]}
        />
      }
      reviews={community.reviews}
      reviewsUnavailable={community.unavailable}
      scheduleContent={
        <BrowserScheduleDetails
          entity={{
            type: "course-offering",
            coursePrefix,
            courseNumber,
            termCode,
          }}
        />
      }
      selectedTermCode={termCode}
      signedIn={community.signedIn}
    />
  );
}
