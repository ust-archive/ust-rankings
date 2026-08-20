import { queryRankings, RankingsUnavailableError } from "@/lib/rankings/server";

type Props = {
  searchParams: Promise<{ term?: string; q?: string }>;
};

export default async function InstructorsPage({ searchParams }: Props) {
  const { term, q } = await searchParams;
  const termCode = term?.trim() || undefined;
  if (termCode && !/^[0-9]{4}$/.test(termCode)) {
    return (
      <section
        className="w-full rounded-xl border border-red-300 bg-red-50 p-6 text-left"
        role="alert"
      >
        <h1 className="text-2xl font-bold text-slate-900">Invalid Term Code</h1>
        <p className="mt-2 text-slate-700">
          Enter a four-digit Term Code or leave the field blank to use the
          latest Term.
        </p>
        <a
          className="mt-4 inline-block font-semibold text-blue-800 underline"
          href="/rankings/instructors"
        >
          View the latest Instructor rankings
        </a>
      </section>
    );
  }

  try {
    const rankings = await queryRankings({
      entity: "instructor",
      preset: "learning",
      termCode,
      search: q,
    });

    return (
      <div className="w-full space-y-8 text-left">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-800">
            Learning-focused preset
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            Instructor Rankings
          </h1>
          <p className="text-slate-600">
            {rankings.population.termCode} · {rankings.population.size} eligible
            Instructors currently teaching
          </p>
        </header>

        <form
          className="flex flex-wrap gap-3"
          action="/rankings/instructors"
          method="get"
        >
          <label className="grid gap-1 font-medium" htmlFor="instructor-search">
            Search Instructors
            <input
              className="h-11 rounded-md border border-slate-300 px-3 font-normal"
              id="instructor-search"
              name="q"
              type="search"
              defaultValue={q}
            />
          </label>
          <label className="grid gap-1 font-medium" htmlFor="ranking-term">
            Term Code
            <input
              className="h-11 w-32 rounded-md border border-slate-300 px-3 font-normal"
              id="ranking-term"
              name="term"
              inputMode="numeric"
              pattern="[0-9]{4}"
              defaultValue={rankings.population.termCode}
            />
          </label>
          <button
            className="self-end rounded-md bg-[#003366] px-5 py-3 font-semibold text-white"
            type="submit"
          >
            Apply
          </button>
        </form>

        {rankings.results.length > 0 ? (
          <ol className="space-y-3" aria-label="Instructor rankings">
            {rankings.results.map((instructor) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                key={instructor.uuid}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-semibold text-slate-900">
                    {instructor.canonicalName}
                  </h2>
                  <strong>
                    Global rank {instructor.globalRank} of{" "}
                    {rankings.population.size}
                  </strong>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Learning-focused score {instructor.score.toFixed(3)} · Local
                  rank {instructor.localRank} · Percentile{" "}
                  {(instructor.percentile * 100).toFixed(1)}%
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>No eligible Instructors match this search.</p>
        )}

        <footer className="break-all text-xs text-slate-500">
          Accepted ranking generation: <code>{rankings.generation}</code>
        </footer>
      </div>
    );
  } catch (error) {
    if (!(error instanceof RankingsUnavailableError)) throw error;
    return (
      <section
        className="w-full rounded-xl border border-amber-300 bg-amber-50 p-6 text-left"
        role="alert"
      >
        <h1 className="text-2xl font-bold text-slate-900">
          Instructor rankings are unavailable
        </h1>
        <p className="mt-2 text-slate-700">
          The validated ranking generation could not be loaded. Other public
          pages remain available.
        </p>
      </section>
    );
  }
}
