"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REVIEW_ORDERS,
  type ReviewOrder,
  reviewOrder,
} from "@/lib/contributions/review-order";

const labels: Record<ReviewOrder, string> = {
  top: "Top",
  popular: "Popular",
  recent: "Recent",
};

export function ReviewOrderSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orders = searchParams.getAll("order");
  const selected = reviewOrder(orders.length === 1 ? orders[0] : undefined);

  return (
    <Select
      name="order"
      onValueChange={(value) => {
        const next = new URLSearchParams(searchParams);
        next.set("order", reviewOrder(value));
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      value={selected}
    >
      <SelectTrigger
        aria-label="Review Order"
        className="h-9 w-auto min-w-24 gap-2 px-2.5"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {REVIEW_ORDERS.map((order) => (
            <SelectItem key={order} value={order}>
              {labels[order]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
