import { Suspense } from "react";
import {
  BrowserCourseDetails,
  BrowserCourseRankings,
} from "@/app/courses/course-details-client";
import type { ReviewEditorOptions } from "@/app/courses/course-reviews";
import {
  DetailsCommunity,
  DetailsCommunityLoading,
} from "@/app/courses/details-sections";
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
import { SignalControls } from "@/app/signals/signal-controls";
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

async function CourseCommunity({
  courseNumber,
  coursePrefix,
  query,
  readReviews,
  selectedTerm,
}: {
  courseNumber: string;
  coursePrefix: string;
  query: RouteSearchParams;
  readReviews: typeof loadCourseReviews;
  selectedTerm?: string;
}) {
  const [community, signalResult] = await Promise.all([
    readReviews(
      coursePrefix,
      courseNumber,
      undefined,
      reviewOrder(query.order),
    ),
    loadSignals({ type: "course", coursePrefix, courseNumber }),
  ]);
  const editor: ReviewEditorOptions = {
    courses: [{ coursePrefix, courseNumber }],
    contexts: [],
    instructors: [],
  };
  return (
    <DetailsCommunity
      description="Published experiences and signals for this Course."
      editor={editor}
      error={
        typeof query.reviewError === "string" ? query.reviewError : undefined
      }
      published={query.review === "published"}
      reviewComposer={
        <BrowserScheduleReviewComposer
          coursePrefix={coursePrefix}
          courseNumber={courseNumber}
          entity={{ type: "course", coursePrefix, courseNumber }}
          initialTermCode={selectedTerm}
        />
      }
      reviews={community.reviews}
      reviewsUnavailable={community.unavailable}
      signedIn={community.signedIn}
      signalControls={
        <SignalControls
          error={
            typeof query.signalError === "string"
              ? query.signalError
              : undefined
          }
          signedIn={community.signedIn}
          summary={signalResult.summary}
          target={{ type: "course", coursePrefix, courseNumber }}
          unavailable={signalResult.unavailable}
        />
      }
      withdrawn={query.review === "withdrawn"}
    />
  );
}

export async function renderCoursePage(
  { params, searchParams }: CoursePageProps,
  readReviews: typeof loadCourseReviews = loadCourseReviews,
) {
  const [query, route] = await Promise.all([searchParams, params]);
  const { coursePrefix, courseNumber } = normalizeCourseRoute(route, query);
  const rankingPreference = await readRankingPreferenceQuery();
  const selectedTerm =
    typeof query.term === "string" && /^[0-9]{4}$/.test(query.term)
      ? query.term
      : undefined;
  return (
    <BrowserCourseDetails
      coursePrefix={coursePrefix}
      courseNumber={courseNumber}
      rankingConfiguration={rankingPreference}
      requestedTermCode={selectedTerm}
      communityContent={
        <Suspense fallback={<DetailsCommunityLoading />}>
          <CourseCommunity
            coursePrefix={coursePrefix}
            courseNumber={courseNumber}
            query={query}
            readReviews={readReviews}
            selectedTerm={selectedTerm}
          />
        </Suspense>
      }
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
    />
  );
}
