"use client";

import { InstructorCard } from "@/components/component/instructor-card";
import { NewDomainBanner } from "@/components/component/new-domain-banner";
import { Input } from "@/components/ui/input";
import { data, search } from "@/data";
import React, { type ChangeEvent } from "react";
import { WindowVirtualizer } from "virtua";

export default function Home() {
  const [query, setQuery] = React.useState("");
  const result = query === "" ? data : search(query);

  return (
    <>
      <NewDomainBanner className="-mt-12 max-w-sm lg:max-w-2xl" />

      <h1 className="text-logo-gradient max-w-sm text-7xl font-bold tracking-tighter lg:max-w-2xl">
        UST Rankings
      </h1>
      <form className="w-full max-w-sm lg:max-w-2xl">
        <Input
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value);
          }}
          className="text-md h-12 rounded-full focus-visible:ring-gray-700"
          placeholder="Search for instructors by Name / Course / etc..."
          type="search"
        />
      </form>
      <div className="w-full max-w-sm px-2 lg:max-w-3xl">
        <WindowVirtualizer>
          {result.map((instructor) => (
            <div key={instructor.id} className="my-2">
              <InstructorCard instructor={instructor} />
            </div>
          ))}
        </WindowVirtualizer>
      </div>
    </>
  );
}
