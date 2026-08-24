import { CourseDetails } from "@/app/courses/course-details";
import { BrowserCourseRankings } from "@/app/courses/course-details-client";
import { loadCourseReviews } from "@/app/courses/review-data";
import {
  normalizeCourseRoute,
  type RouteSearchParams,
} from "@/app/courses/routes";
import {
  BrowserScheduleDetails,
  BrowserScheduleReviewComposer,
} from "@/app/courses/schedule-client";
import { loadSignals } from "@/app/signals/data";
import { reviewOrder } from "@/lib/contributions/review-order";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";

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
  const [rankingPreference, community, signalResult] = await Promise.all([
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
      : undefined;
  return (
    <CourseDetails
      coursePrefix={coursePrefix}
      courseNumber={courseNumber}
      rankingsContent={
        <BrowserCourseRankings
          coursePrefix={coursePrefix}
          courseNumber={courseNumber}
          rankingConfiguration={rankingPreference}
          selectedTermCode={selectedTerm}
          termNames={[]}
        />
      }
      scheduleContent={
        <BrowserScheduleDetails
          entity={{ type: "course", coursePrefix, courseNumber }}
        />
      }
      selectedTermCode={selectedTerm}
      reviewComposerContent={
        <BrowserScheduleReviewComposer
          coursePrefix={coursePrefix}
          courseNumber={courseNumber}
          entity={{ type: "course", coursePrefix, courseNumber }}
          initialTermCode={selectedTerm}
        />
      }
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
