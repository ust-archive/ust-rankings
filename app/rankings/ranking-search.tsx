"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

  useEffect(() => {
    if (value === currentValue) return;
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(queryString);
      if (value) next.set("q", value);
      else next.delete("q");
      next.delete("cursor");
      startTransition(() => {
        router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
          scroll: false,
        });
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [currentValue, pathname, queryString, router, value]);

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
