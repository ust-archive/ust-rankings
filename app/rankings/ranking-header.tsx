export function RankingHeader({ entity }: { entity: "Course" | "Instructor" }) {
  return (
    <header className="text-center">
      <h1 className="text-logo-gradient text-5xl font-bold leading-none tracking-tighter sm:text-7xl">
        UST Rankings
      </h1>
      <p className="mt-3 text-sm font-semibold tracking-wide text-slate-600">
        {entity} rankings
      </p>
    </header>
  );
}
