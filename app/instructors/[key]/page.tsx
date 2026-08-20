import { notFound } from "next/navigation";
import { InstructorDetails } from "@/app/instructors/instructor-details";
import {
  type InstructorRouteSearchParams,
  instructorRedirect,
  normalizeInstructorRoute,
} from "@/app/instructors/routes";
import {
  getRankings,
  RankingsUnavailableError,
  UnknownRankingsEntityError,
} from "@/lib/rankings/server";
import {
  getSchedule,
  InvalidScheduleQueryError,
  ScheduleUnavailableError,
} from "@/lib/schedule/server";

export default async function InstructorPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<InstructorRouteSearchParams>;
}) {
  const query = await searchParams;
  const key = normalizeInstructorRoute((await params).key, query);
  const selectedTerm =
    typeof query.term === "string" && /^[0-9]{4}$/.test(query.term)
      ? query.term
      : undefined;
  try {
    const rankings = await getRankings(
      { type: "instructor", key },
      { termCode: selectedTerm },
    );
    if (rankings.route.redirect)
      instructorRedirect(rankings.route.canonicalKey, query);
    const scheduleResult = await getSchedule({
      type: "instructor",
      uuid: rankings.instructor.uuid,
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
    return (
      <InstructorDetails
        rankings={rankings}
        classes={scheduleResult.classes}
        scheduleUnavailable={scheduleResult.unavailable}
        selectedTermCode={rankings.population.termCode}
      />
    );
  } catch (error) {
    if (error instanceof UnknownRankingsEntityError) notFound();
    if (!(error instanceof RankingsUnavailableError)) throw error;
    return (
      <section
        className="w-full rounded-xl border border-amber-300 bg-amber-50 p-6 text-left"
        role="alert"
      >
        <h1 className="text-2xl font-bold text-slate-900">
          Instructor details are unavailable
        </h1>
        <p className="mt-2 text-slate-700">
          The validated Instructor registry and ranking generation could not be
          loaded. Schedule and other public pages remain available.
        </p>
      </section>
    );
  }
}
