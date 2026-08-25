"use client";

import { Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { withoutRankingPagination } from "@/lib/rankings/url";

export function RankingSearch({
  entity,
  initialValue,
}: {
  entity: "course" | "instructor";
  initialValue: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentValue = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initialValue);

  useEffect(() => setValue(currentValue), [currentValue]);

  function search(value: string) {
    setValue(value);
    const next = withoutRankingPagination(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    window.history.replaceState(
      null,
      "",
      `${pathname}${next.size ? `?${next}` : ""}`,
    );
  }

  const label = entity === "course" ? "Search Courses" : "Search Instructors";
  return (
    <InputGroup className="h-12 min-w-0 flex-1 rounded-full bg-white">
      <InputGroupAddon className="cursor-default">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        autoComplete="off"
        id="ranking-search"
        maxLength={100}
        name="q"
        onChange={(event) => search(event.target.value)}
        placeholder={
          entity === "course"
            ? "Search for courses by name / instructor / etc…"
            : "Search for instructors by name / course / etc…"
        }
        spellCheck={false}
        type="search"
        value={value}
      />
    </InputGroup>
  );
}
