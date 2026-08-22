import { notFound } from "next/navigation";
import { loadReviews } from "@/app/courses/review-data";
import { InstructorDetails } from "@/app/instructors/instructor-details";
import {
  type InstructorRouteSearchParams,
  instructorRedirect,
  normalizeInstructorRoute,
} from "@/app/instructors/routes";
import { loadSignals } from "@/app/signals/data";
import { readRankingPreferenceQuery } from "@/lib/rankings/preference-server";
import {
  getInstructorIdentity,
  getRankings,
  InvalidRankingsQueryError,
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

  let invalidTermCode: string | undefined;
  const rankingsPromise = getRankings(
    { type: "instructor", uuid: identity.instructor.uuid },
    { ...rankingPreference, termCode: selectedTerm },
  ).catch(async (error) => {
    if (error instanceof InvalidRankingsQueryError && selectedTerm) {
      invalidTermCode = selectedTerm;
      return getRankings(
        {
          type: "instructor",
          uuid: identity.instructor.uuid,
        },
        rankingPreference,
      );
    }
    if (
      error instanceof RankingsUnavailableError ||
      error instanceof UnknownRankingsEntityError
    )
      return undefined;
    throw error;
  });
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
  const [rankings, scheduleResult, signalResult, reviewResult] =
    await Promise.all([
      rankingsPromise,
      schedulePromise,
      loadSignals({
        type: "instructor",
        instructorUuid: identity.instructor.uuid,
      }),
      readReviews({
        type: "instructor",
        instructorUuids: identity.familyUuids,
      }),
    ]);
  const classes = scheduleResult.classes.filter(
    (scheduleClass) =>
      !identity.identityHistory.affectedAssociations.some(
        (affected) =>
          (affected.termCode === undefined ||
            affected.termCode === scheduleClass.termCode) &&
          (affected.courseCode === undefined ||
            affected.courseCode === scheduleClass.courseCode) &&
          scheduleClass.meetings.some((meeting) =>
            meeting.instructors.some(
              (instructor) =>
                instructor.sourceName.trim().toLowerCase() ===
                affected.sourceName.trim().toLowerCase(),
            ),
          ),
      ),
  );
  const selectedTermCode =
    rankings?.population.termCode ?? selectedTerm ?? classes.at(-1)?.termCode;
  return (
    <InstructorDetails
      identity={identity}
      rankings={rankings}
      classes={classes}
      scheduleUnavailable={scheduleResult.unavailable}
      selectedTermCode={selectedTermCode}
      invalidTermCode={invalidTermCode}
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
