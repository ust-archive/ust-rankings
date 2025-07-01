"use client";

import { CourseCard } from "@/app/course/course-card";
import { compileFilter, Filter } from "@/app/course/filter";
import { SettingsCard } from "@/app/course/settings-card";
import { TermSelect } from "@/components/component/term-select";
import { Input } from "@/components/ui/input";
import { search } from "@/data/course";
import { currentTerm } from "@/data/cq";
import { termCode2Num } from "@/data/ratings";
import React, { type ChangeEvent, useState } from "react";
import { WindowVirtualizer } from "virtua";

export default function Course() {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState(currentTerm.term);
  const [formula, setFormula] = useState(
    "" +
      "content.bayesian * 2/3 * 0.4 + \n" +
      "teaching.bayesian * 2/3 * 0.4 + \n" +
      "grading.bayesian * 2/3 * 0.15 + \n" +
      "workload.bayesian * 2/3 * 0.05 + \n" +
      "course.bayesian * 1/3 * 0.75 + \n" +
      "instructor.bayesian * 1/3 * 0.25",
  );

  const [filter, setFilter] = useState<Filter>({});

  const result = (() => {
    try {
      return search(query, termCode2Num(term), formula).filter(
        compileFilter(filter, termCode2Num(term)),
      );
    } catch (e) {
      console.error("Error in search:", e);
      return [];
    }
  })();

  return (
    <>
      <h1 className="text-logo-gradient max-w-sm text-7xl font-bold tracking-tighter lg:max-w-2xl">
        UST Rankings
      </h1>
      <section className="w-full max-w-sm items-center space-y-4 lg:max-w-2xl">
        <div className="flex w-full items-center gap-4">
          <Input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}
            className="text-md h-12 rounded-full focus-visible:ring-gray-700"
            placeholder="Search for coureses by name / instructor / etc."
            type="search"
          />
          <TermSelect term={term} onTermChange={setTerm} />
        </div>

        <div className="w-full px-2 lg:max-w-3xl">
          <SettingsCard
            formula={formula}
            setFormula={setFormula}
            filter={filter}
            setFilter={setFilter}
          />
        </div>
      </section>

      <div className="w-full max-w-sm px-2 lg:max-w-3xl">
        <WindowVirtualizer>
          {result.map((courseObj) => (
            <div
              key={courseObj.meta.subject + courseObj.meta.code}
              className="my-2"
            >
              <CourseCard ratings={courseObj} term={termCode2Num(term)} />
            </div>
          ))}
        </WindowVirtualizer>
      </div>
    </>
  );
}
