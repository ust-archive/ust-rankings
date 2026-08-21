"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

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
  const submittedValue = useRef(initialValue);
  const timeout = useRef<number | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (currentValue !== submittedValue.current) setValue(currentValue);
  }, [currentValue]);

  const navigate = useCallback(
    (search: string) => {
      const next = new URLSearchParams(queryString);
      if (search) next.set("q", search);
      else next.delete("q");
      next.delete("cursor");
      next.delete("pages");
      submittedValue.current = search;
      startTransition(() => {
        router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
          scroll: false,
        });
      });
    },
    [pathname, queryString, router],
  );

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
          navigate(value);
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
