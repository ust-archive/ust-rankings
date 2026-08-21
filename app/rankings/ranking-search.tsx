"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const currentValue = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initialValue);
  const latestSubmittedValue = useRef(initialValue);
  const submittedValues = useRef(new Set<string>());
  const timeout = useRef<number | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (search: string) => {
      const next = withoutRankingPagination(queryString);
      if (search) next.set("q", search);
      else next.delete("q");
      latestSubmittedValue.current = search;
      submittedValues.current.add(search);
      startTransition(() => {
        router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
          scroll: false,
        });
      });
    },
    [pathname, queryString, router],
  );

  useEffect(() => {
    if (submittedValues.current.delete(currentValue)) {
      if (currentValue !== latestSubmittedValue.current)
        navigate(latestSubmittedValue.current);
      return;
    }
    latestSubmittedValue.current = currentValue;
    setValue(currentValue);
  }, [currentValue, navigate]);

  useEffect(() => {
    if (value === currentValue) return;
    timeout.current = window.setTimeout(() => navigate(value), 300);
    return () => window.clearTimeout(timeout.current);
  }, [currentValue, navigate, value]);

  const label = entity === "course" ? "Search Courses" : "Search Instructors";
  return (
    <InputGroup
      aria-busy={isPending}
      className="h-12 min-w-0 flex-1 rounded-full bg-white"
    >
      <InputGroupAddon className="cursor-default">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        autoComplete="off"
        id="ranking-search"
        maxLength={100}
        name="q"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          window.clearTimeout(timeout.current);
          navigate(event.currentTarget.value);
        }}
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
