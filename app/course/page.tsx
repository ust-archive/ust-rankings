"use client";

import { CourseCard } from "@/app/course/course-card";
import { NewDomainBanner } from "@/components/component/new-domain-banner";
import { Input } from "@/components/ui/input";
import {
  CourseRatingWeights,
  CourseSortBy,
  searchCourses,
} from "@/data/course";
import dynamic from "next/dynamic";
import React, { type ChangeEvent, useState } from "react";
import { WindowVirtualizer } from "virtua";

const SettingsCard = dynamic(
  async () => (await import("./settings-card")).SettingsCard,
  { ssr: false },
);

export default function Course() {
  const [query, setQuery] = useState("");

  const [sortBy, setSortBy] = useState<CourseSortBy>("bayesianScore");
  const [ratingWeights, setRatingWeights] = useState<CourseRatingWeights>({
    ratingContent: 0.3,
    ratingTeaching: 0.3,
    ratingGrading: 0.3,
    ratingWorkload: 0.1,
  });

  const result = searchCourses(query, sortBy, ratingWeights);

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
          {result.map((courseObj) => (
            <div key={courseObj.subject + courseObj.number} className="my-2">
              <CourseCard courseObj={courseObj} sortBy={sortBy} />
            </div>
          ))}
        </WindowVirtualizer>
      </div>
    </>
  );
}
