import { notFound } from "next/navigation";
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
import { reviewOrder } from "@/lib/contributions/review-order";
import { normalizeInstructorUuid } from "@/lib/instructor-identity";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";
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
  const classes = [];
  const selectedTermCode = undefined;
  return (
    <BrowserInstructorDetails
      communityInstructorUuid={identity.instructor.uuid}
      identity={identity}
      instructorKey={browserInstructorKey}
      rankingConfiguration={rankingPreference}
      requestedTermCode={selectedTerm}
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
      reviewComposerContent={
        <BrowserInstructorReviewComposer
          classes={classes}
          fallbackIdentity={identity}
          instructorKey={browserInstructorKey}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
          selectedTermCode={selectedTermCode}
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
      signals={signalResult.summary}
      signalsUnavailable={signalResult.unavailable}
      signedIn={reviewResult.signedIn}
      signalError={
        typeof query.signalError === "string" ? query.signalError : undefined
      }
      reviews={reviewResult.reviews}
      reviewsUnavailable={reviewResult.unavailable}
      reviewPublished={query.review === "published"}
      reviewWithdrawn={query.review === "withdrawn"}
      reviewError={
        typeof query.reviewError === "string" ? query.reviewError : undefined
      }
    />
  );
}
