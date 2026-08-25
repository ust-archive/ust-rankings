import { Card, CardContent, CardHeader } from "@/components/ui/card";

const placeholders = [0, 1, 2];

export function RankingCardSkeletons({
  entity,
}: {
  entity: "Course" | "Instructor";
}) {
  return (
    <div
      aria-label={`Loading ${entity} rankings`}
      className="flex flex-col gap-3"
      role="status"
    >
      {placeholders.map((placeholder) => (
        <Card
          aria-hidden="true"
          className="grid animate-pulse grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-white p-4 sm:gap-5 sm:p-6"
          data-ranking-card-skeleton
          key={placeholder}
        >
          <CardContent className="flex w-20 flex-col gap-2 p-0 sm:w-32">
            <div className="h-7 w-16 rounded bg-slate-200 sm:w-24" />
            <div className="h-3 w-14 rounded bg-slate-100 sm:hidden" />
          </CardContent>
          <CardHeader className="min-w-0 gap-1 p-0">
            <div className="h-[30px] w-2/3 rounded bg-slate-200" />
            {entity === "Course" ? (
              <div className="h-4 w-1/2 rounded bg-slate-200" />
            ) : null}
            <div className="h-4 w-full rounded bg-slate-100" />
            <div className="h-3 w-4/5 rounded bg-slate-100" />
          </CardHeader>
          <CardContent className="p-0">
            <div className="size-12 rounded-lg bg-slate-200" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
