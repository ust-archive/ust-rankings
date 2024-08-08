"use client";

import { InstructorCard } from "@/components/component/instructor-card";
import { NewDomainBanner } from "@/components/component/new-domain-banner";
import { Input } from "@/components/ui/input";
import { search, type SortBy } from "@/data";
import dynamic from "next/dynamic";
import React, { type ChangeEvent, useState } from "react";
import { WindowVirtualizer } from "virtua";

const SettingsCard = dynamic(
  async () =>
    (await import("@/components/component/settings-card")).SettingsCard,
  { ssr: false },
);

export default function Home() {
  const [query, setQuery] = useState("");

  const [sortBy, setSortBy] = useState<SortBy>("bayesianScore");
  const [ratingWeights, setRatingWeights] = useState({
    ratingContent: 0.1,
    ratingTeaching: 0.5,
    ratingGrading: 0.05,
    ratingWorkload: 0.05,
    ratingInstructor: 0.3,
  });

  const result = search(query, sortBy, ratingWeights);

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

      <div className="max-w- w-full max-w-sm px-2 lg:max-w-3xl">
        <SettingsCard
          sortBy={sortBy}
          setSortBy={setSortBy}
          formula={ratingWeights}
          setFormula={setRatingWeights}
        />
      </div>

      <div className="w-full max-w-sm px-2 lg:max-w-3xl">
        <WindowVirtualizer>
          {result.map((instructorObj) => (
            <div key={instructorObj.instructor} className="my-2">
              <InstructorCard instructorObj={instructorObj} sortBy={sortBy} />
            </div>
          ))}
        </WindowVirtualizer>
      </div>
    </>
  );
}
