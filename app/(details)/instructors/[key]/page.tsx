import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReviewEditorOptions } from "@/app/courses/course-reviews";
import {
  DetailsCommunity,
  DetailsCommunityLoading,
} from "@/app/courses/details-sections";
import { loadReviews } from "@/app/courses/review-data";
import {
  BrowserInstructorDetails,
  BrowserInstructorIdentity,
  BrowserInstructorRankings,
  BrowserInstructorReviewComposer,
  BrowserInstructorTeaching,
} from "@/app/instructors/instructor-details-client";
import {
  type InstructorRouteSearchParams,
  instructorRedirect,
  normalizeInstructorRoute,
} from "@/app/instructors/routes";
import { loadSignals } from "@/app/signals/data";
import { SignalControls } from "@/app/signals/signal-controls";
import { reviewOrder } from "@/lib/contributions/review-order";
import { normalizeInstructorUuid } from "@/lib/instructor-identity";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";
import type { InstructorIdentityLookup } from "@/lib/rankings/server";
import {
  currentServerIndex,
  ServerIndexUnavailableError,
} from "@/lib/server-index";

export const dynamic = "force-dynamic";

type InstructorPageProps = {
  params: Promise<{ key: string }>;
  searchParams: Promise<InstructorRouteSearchParams>;
};

function pinnedInstructor(searchParams: InstructorRouteSearchParams) {
  const generation = searchParams._generation;
  const instructorUuid =
    typeof searchParams._instructor === "string"
      ? normalizeInstructorUuid(searchParams._instructor)
      : undefined;
  return typeof generation === "string" &&
    /^[0-9a-f]{64}$/.test(generation) &&
    instructorUuid
    ? { generation, instructorUuid }
    : undefined;
}

export default function InstructorPage(props: InstructorPageProps) {
  return renderInstructorPage(props);
}

async function InstructorCommunity({
  browserInstructorKey,
  identity,
  query,
  rankingPreference,
  readReviews,
  requestedTermCode,
}: {
  browserInstructorKey: string;
  identity: InstructorIdentityLookup;
  query: InstructorRouteSearchParams;
  rankingPreference: Awaited<ReturnType<typeof readRankingPreferenceQuery>>;
  readReviews: typeof loadReviews;
  requestedTermCode?: string;
}) {
  const [signalResult, reviewResult] = await Promise.all([
    loadSignals({
      type: "instructor",
      instructorUuid: identity.instructor.uuid,
    }),
    readReviews({
      type: "instructor",
      instructorUuids: identity.familyUuids,
      order: reviewOrder(query.order),
    }),
  ]);
  const editor: ReviewEditorOptions = {
    courses: [],
    contexts: [],
    instructors: [
      {
        instructorUuid: identity.instructor.uuid,
        name: identity.instructor.canonicalName,
      },
    ],
  };
  return (
    <DetailsCommunity
      editor={editor}
      error={
        typeof query.reviewError === "string" ? query.reviewError : undefined
      }
      published={query.review === "published"}
      reviewComposer={
        <BrowserInstructorReviewComposer
          classes={[]}
          fallbackIdentity={identity}
          instructorKey={browserInstructorKey}
          rankingConfiguration={rankingPreference}
          requestedTermCode={requestedTermCode}
        />
      }
      reviews={reviewResult.reviews}
      reviewsUnavailable={reviewResult.unavailable}
      signedIn={reviewResult.signedIn}
      signalControls={
        <SignalControls
          error={
            typeof query.signalError === "string"
              ? query.signalError
              : undefined
          }
          signedIn={reviewResult.signedIn}
          summary={signalResult.summary}
          target={{
            type: "instructor",
            instructorUuid: identity.instructor.uuid,
          }}
          unavailable={signalResult.unavailable}
        />
      }
      withdrawn={query.review === "withdrawn"}
    />
  );
}

export async function renderInstructorPage(
  { params, searchParams }: InstructorPageProps,
  readReviews: typeof loadReviews = loadReviews,
) {
  const [query, route] = await Promise.all([searchParams, params]);
  const key = normalizeInstructorRoute(route.key, query);
  const selectedTerm =
    typeof query.term === "string" && /^[0-9]{4}$/.test(query.term)
      ? query.term
      : undefined;
  const requestedPin = pinnedInstructor(query);
  const [identity, rankingPreference] = await Promise.all([
    currentServerIndex()
      .then((index) => index.instructorIdentity(key) ?? notFound())
      .catch((error) => {
        if (!(error instanceof ServerIndexUnavailableError)) throw error;
        return undefined;
      }),
    readRankingPreferenceQuery(),
  ]);
  if (!identity)
    return (
      <section
        className="w-full rounded-xl border border-amber-300 bg-amber-50 p-6 text-left"
        role="alert"
      >
        <h1 className="text-2xl font-bold text-slate-900">
          Instructor identity is unavailable
        </h1>
        <p className="mt-2 text-slate-700">
          The validated Instructor registry could not be loaded. Other public
          pages remain available.
        </p>
      </section>
    );
  const pinned =
    requestedPin && identity.familyUuids.includes(requestedPin.instructorUuid)
      ? requestedPin
      : undefined;
  if (identity.route.redirect)
    instructorRedirect(identity.route.canonicalKey, query);

  const browserInstructorKey =
    pinned?.instructorUuid ?? identity.instructor.uuid;
  const classes = [];
  const selectedTermCode = undefined;
  return (
    <BrowserInstructorDetails
      communityInstructorUuid={identity.instructor.uuid}
      identity={identity}
      instructorKey={browserInstructorKey}
      rankingConfiguration={rankingPreference}
      requestedTermCode={selectedTerm}
      communityContent={
        <Suspense fallback={<DetailsCommunityLoading />}>
          <InstructorCommunity
            browserInstructorKey={browserInstructorKey}
            identity={identity}
            query={query}
            rankingPreference={rankingPreference}
            readReviews={readReviews}
            requestedTermCode={selectedTerm}
          />
        </Suspense>
      }
      identityContent={
        <BrowserInstructorIdentity
          fallbackIdentity={identity}
          instructorKey={browserInstructorKey}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
        />
      }
      rankingsContent={
        <BrowserInstructorRankings
          instructorKey={browserInstructorKey}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
        />
      }
      classes={classes}
      scheduleUnavailable={false}
      selectedTermCode={selectedTermCode}
      teachingContent={
        <BrowserInstructorTeaching
          fallbackIdentity={identity}
          instructorKey={browserInstructorKey}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
        />
      }
    />
  );
}
