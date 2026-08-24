import { notFound } from "next/navigation";
import { loadReviews } from "@/app/courses/review-data";
import { InstructorDetails } from "@/app/instructors/instructor-details";
import {
  BrowserInstructorIdentity,
  BrowserInstructorRankings,
  BrowserInstructorReviewComposer,
} from "@/app/instructors/instructor-details-client";
import {
  type InstructorRouteSearchParams,
  instructorRedirect,
  normalizeInstructorRoute,
} from "@/app/instructors/routes";
import { loadSignals } from "@/app/signals/data";
import { reviewOrder } from "@/lib/contributions/review-order";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";
import {
  getInstructorIdentity,
  RankingsUnavailableError,
  UnknownRankingsEntityError,
} from "@/lib/rankings/server";
import {
  getSchedule,
  InvalidScheduleQueryError,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

export const dynamic = "force-dynamic";

type InstructorPageProps = {
  params: Promise<{ key: string }>;
  searchParams: Promise<InstructorRouteSearchParams>;
};

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
  const [identity, rankingPreference] = await Promise.all([
    getInstructorIdentity(key).catch((error) => {
      if (error instanceof UnknownRankingsEntityError) notFound();
      if (!(error instanceof RankingsUnavailableError)) throw error;
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
  if (identity.route.redirect)
    instructorRedirect(identity.route.canonicalKey, query);

  const schedulePromise = getSchedule({
    type: "instructor",
    uuids: identity.familyUuids,
  }).then(
    (schedule) => ({
      classes: schedule.type === "instructor" ? schedule.classes : [],
      unavailable: false,
    }),
    (error) => {
      if (error instanceof ScheduleUnavailableError)
        return { classes: [], unavailable: true };
      if (error instanceof InvalidScheduleQueryError)
        return { classes: [], unavailable: false };
      throw error;
    },
  );
  const [scheduleResult, signalResult, reviewResult] = await Promise.all([
    schedulePromise,
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
  const classes = scheduleResult.classes.filter(
    (scheduleClass) =>
      !identity.identityHistory.associationCorrections.some(
        (correction) =>
          correction.correctionType === "split" &&
          correction.status === "needs-resolution" &&
          (correction.termCode === undefined ||
            correction.termCode === scheduleClass.termCode) &&
          correction.courseCode === scheduleClass.courseCode &&
          scheduleClass.meetings.some((meeting) =>
            meeting.instructors.some(
              (instructor) =>
                instructor.sourceName.trim().toLowerCase() ===
                correction.sourceName.trim().toLowerCase(),
            ),
          ),
      ),
  );
  const selectedTermCode = classes.at(-1)?.termCode;
  return (
    <InstructorDetails
      identity={identity}
      identityContent={
        <BrowserInstructorIdentity
          expectedRankingRevision={identity.generation}
          fallbackIdentity={identity}
          instructorKey={identity.instructor.uuid}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
        />
      }
      rankingsContent={
        <BrowserInstructorRankings
          expectedRankingRevision={identity.generation}
          instructorKey={identity.instructor.uuid}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
        />
      }
      reviewComposerContent={
        <BrowserInstructorReviewComposer
          classes={classes}
          expectedRankingRevision={identity.generation}
          fallbackIdentity={identity}
          instructorKey={identity.instructor.uuid}
          rankingConfiguration={rankingPreference}
          requestedTermCode={selectedTerm}
          selectedTermCode={selectedTermCode}
        />
      }
      classes={classes}
      scheduleUnavailable={scheduleResult.unavailable}
      selectedTermCode={selectedTermCode}
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
