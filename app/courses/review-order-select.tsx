"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReviewOrder, reviewOrder } from "@/lib/contributions/reviews";

const labels: Record<ReviewOrder, string> = {
  top: "Top",
  popular: "Popular",
  recent: "Recent",
};

export function ReviewOrderSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = reviewOrder(searchParams.get("order"));

  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      Order
      <select
        className="min-h-11 rounded-lg border border-input bg-background px-3 py-2"
        onChange={(event) => {
          const next = new URLSearchParams(searchParams);
          next.set("order", event.target.value);
          router.replace(`${pathname}?${next}`, { scroll: false });
        }}
        value={selected}
      >
        {Object.entries(labels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
