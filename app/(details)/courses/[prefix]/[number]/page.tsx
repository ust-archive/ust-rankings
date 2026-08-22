import { notFound } from "next/navigation";
import { CourseDetails } from "@/app/courses/course-details";
import { loadCourseRankings } from "@/app/courses/data";
import { loadCourseReviews } from "@/app/courses/review-data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import { loadSignals } from "@/app/signals/data";
import { reviewOrder } from "@/lib/contributions/review-order";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";
import {
  getSchedule,
  InvalidScheduleQueryError,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

export const dynamic = "force-dynamic";

type CoursePageProps = {
  params: Promise<{ prefix: string; number: string }>;
  searchParams: Promise<RouteSearchParams>;
};

export default function CoursePage(props: CoursePageProps) {
  return renderCoursePage(props);
}

export async function renderCoursePage(
  { params, searchParams }: CoursePageProps,
  readReviews: typeof loadCourseReviews = loadCourseReviews,
) {
  const [query, route] = await Promise.all([searchParams, params]);
  const { coursePrefix, courseNumber } = normalizeCourseRoute(route, query);
  const schedulePromise = getSchedule({
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
  const [scheduleResult, rankingPreference, community, signalResult] =
    await Promise.all([
      schedulePromise,
      readRankingPreferenceQuery(),
      readReviews(
        coursePrefix,
        courseNumber,
        undefined,
        reviewOrder(query.order),
      ),
      loadSignals({ type: "course", coursePrefix, courseNumber }),
    ]);
  const selectedTerm =
    typeof query.term === "string" && /^[0-9]{4}$/.test(query.term)
      ? query.term
      : scheduleResult.schedule?.offerings.at(-1)?.termCode;
  const rankings = await loadCourseRankings(
    coursePrefix,
    courseNumber,
    selectedTerm,
    rankingPreference,
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
      reviews={community.reviews}
      reviewsUnavailable={community.unavailable}
      reviewPublished={query.review === "published"}
      reviewWithdrawn={query.review === "withdrawn"}
      reviewError={
        typeof query.reviewError === "string" ? query.reviewError : undefined
      }
      signals={signalResult.summary}
      signalsUnavailable={signalResult.unavailable}
      signedIn={community.signedIn}
      signalError={
        typeof query.signalError === "string" ? query.signalError : undefined
      }
    />
  );
}
