import { Spinner } from "@/components/ui/spinner";

export default function RankingsLoading() {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 rounded-xl border bg-white p-6 text-left"
    >
      <Spinner aria-hidden="true" />
      <p className="font-semibold">Loading rankings…</p>
    </div>
  );
}
