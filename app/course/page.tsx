"use client";

import { CourseCard } from "@/app/course/course-card";
import { SettingsCard } from "@/components/component/settings-card";
import { TermSelect } from "@/components/component/term-select";
import { Input } from "@/components/ui/input";
import { search } from "@/data/course";
import { currentTerm } from "@/data/cq";
import { CriteriaName, termCode2Num } from "@/data/ratings";
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

  const result = (() => {
    try {
      return search(query, termCode2Num(term), formula);
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
            tooltip={
              <article>
                <p>The formula of the score of the course.</p>
                <p>
                  The formula is a JavaScript-like expression that calculates
                  the score for each course. You can use the following variables
                  for each criterion:
                </p>

                <ul>
                  <li>
                    <code>content</code> - {CriteriaName["content"]}
                  </li>
                  <li>
                    <code>teaching</code> - {CriteriaName["teaching"]}
                  </li>
                  <li>
                    <code>grading</code> - {CriteriaName["grading"]}
                  </li>
                  <li>
                    <code>workload</code> - {CriteriaName["workload"]}
                  </li>
                  <li>
                    <code>course</code> - {CriteriaName["course"]}
                  </li>
                  <li>
                    <code>instructor</code> - {CriteriaName["instructor"]}
                  </li>
                </ul>
                <p>Each variable has two properties:</p>
                <ul>
                  <li>
                    <code>.rating</code> - the average rating of the criterion.
                    In other words, it represents the simple weighted average.
                  </li>
                  <li>
                    <code>.bayesian</code> - the Bayesian-adjusted rating of the
                    criterion. In other words, it represents the Bayesian
                    average, which considers the number of samples, ensuring
                    that the score is not skewed by a small number of ratings.
                  </li>
                </ul>
                <p>
                  The preset formula is designed to reflect the quality of the
                  course itself. Therefore, the content and teaching criteria
                  weigh more heavily. The grading, on the other hand, is
                  restricted by the university itself, so it weighs less. The
                  workload is nothing to do with the quality of the course, so
                  it weighs only a little.
                </p>
                <p>
                  Of course, this is our own opinion. It might not fit your own
                  preference. You can always change the formula to your own
                  preference!
                </p>
              </article>
            }
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
