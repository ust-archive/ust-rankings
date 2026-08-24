import { notFound } from "next/navigation";
import { ClassDetails, UnavailableDetail } from "@/app/courses/course-details";
import { BrowserCourseRankings } from "@/app/courses/course-details-client";
import { loadReviews } from "@/app/courses/review-data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import { reviewOrder } from "@/lib/contributions/review-order";
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
    const [scheduleClass, community] = await Promise.all([
      getSchedule({
        type: "class",
        coursePrefix,
        courseNumber,
        termCode,
        section,
      }),
      loadReviews({
        type: "course",
        coursePrefix,
        courseNumber,
        termCode,
        section,
        order: reviewOrder(query.order),
      }),
    ]);
    if (scheduleClass.type !== "class") notFound();
    return (
      <ClassDetails
        rankingsContent={
          <BrowserCourseRankings
            coursePrefix={coursePrefix}
            courseNumber={courseNumber}
            rankingConfiguration={rankingPreference}
            selectedTermCode={termCode}
            termNames={[]}
          />
        }
        scheduleClass={scheduleClass}
        reviews={community.reviews}
        reviewsUnavailable={community.unavailable}
        signedIn={community.signedIn}
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
