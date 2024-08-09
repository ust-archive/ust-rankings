"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input, type InputProps } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CourseRatingWeights, CourseSortBy } from "@/data/course";
import { stopPropagation } from "@/lib/events";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { type ChangeEvent, forwardRef } from "react";

export type SettingsCardProps = {
  sortBy: CourseSortBy;
  setSortBy: (sortBy: CourseSortBy) => void;

  formula: CourseRatingWeights;
  setFormula: (ratingWeights: CourseRatingWeights) => void;
};

const NumInput = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <Input
    type="number"
    className={"my-1 ml-3 inline h-8 w-20 overscroll-none"}
    step={0.05}
    ref={ref}
    onWheel={stopPropagation}
    {...props}
  />
));
NumInput.displayName = "NumInput";

export function SettingsCard(props: SettingsCardProps) {
  const { sortBy, setSortBy } = props;
  const { formula, setFormula } = props;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <Collapsible className="space-y-2">
          <CollapsibleTrigger className="flex w-full items-center">
            <div className="flex-grow text-left text-sm font-semibold hover:underline">
              Sort by...
            </div>
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger>
                  <QuestionMarkCircledIcon />
                </TooltipTrigger>
                <TooltipContent className="max-w-xl p-4 text-left">
                  <p>Sort the instructors by the selected criterion.</p>
                  <ul>
                    <li>
                      Score: The overall score of the course, calculated by the
                      formula below.
                    </li>
                    <li>Content: The rating of the content of the course.</li>
                    <li>Teaching: The rating of the teaching of the course.</li>
                    <li>Grading: The rating of the grading of the course.</li>
                    <li>Workload: The rating of the workload of the course.</li>
                    <li>
                      Abs: If not selected, the sorting will take the samples
                      count into consideration; otherwise, the sorting will only
                      take the value into consideration.
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
            <ToggleGroup
              className="flex-wrap"
              type="single"
              variant="outline"
              value={sortBy}
              onValueChange={setSortBy}
            >
              <ToggleGroupItem value="bayesianScore">Score</ToggleGroupItem>
              <ToggleGroupItem value="bayesianRatingContent">
                Content
              </ToggleGroupItem>
              <ToggleGroupItem value="bayesianRatingTeaching">
                Teaching
              </ToggleGroupItem>
              <ToggleGroupItem value="bayesianRatingGrading">
                Grading
              </ToggleGroupItem>
              <ToggleGroupItem value="bayesianRatingWorkload">
                Workload
              </ToggleGroupItem>
              <ToggleGroupItem value="score">Score (Abs)</ToggleGroupItem>
              <ToggleGroupItem value="ratingContent">
                Content (Abs)
              </ToggleGroupItem>
              <ToggleGroupItem value="ratingTeaching">
                Teaching (Abs)
              </ToggleGroupItem>
              <ToggleGroupItem value="ratingGrading">
                Grading (Abs)
              </ToggleGroupItem>
              <ToggleGroupItem value="ratingWorkload">
                Workload (Abs)
              </ToggleGroupItem>
            </ToggleGroup>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible className="space-y-2">
          <CollapsibleTrigger className="flex w-full items-center">
            <div className="flex-grow text-left text-sm font-semibold hover:underline">
              Score Formula...
            </div>
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger>
                  <QuestionMarkCircledIcon />
                </TooltipTrigger>
                <TooltipContent className="max-w-xl p-4 text-left">
                  <p>The formula of the score of the course.</p>
                  <p>
                    The preset formula is designed to reflect the score of the
                    course itself, rather than the difficulty. Therefore, the
                    content, teaching and grading are weighted more than the
                    workload.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
            <div className="spacing-x-2">
              Score =
              <span className="inline-block">
                <NumInput
                  value={formula.ratingContent}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setFormula({
                      ...formula,
                      ratingContent: e.target.valueAsNumber,
                    });
                  }}
                />{" "}
                * Content{" "}
              </span>{" "}
              +
              <span className="inline-block">
                <NumInput
                  value={formula.ratingTeaching}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setFormula({
                      ...formula,
                      ratingTeaching: e.target.valueAsNumber,
                    });
                  }}
                />{" "}
                * Teaching{" "}
              </span>{" "}
              +
              <span className="inline-block">
                <NumInput
                  value={formula.ratingGrading}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setFormula({
                      ...formula,
                      ratingGrading: e.target.valueAsNumber,
                    });
                  }}
                />{" "}
                * Grading{" "}
              </span>{" "}
              +
              <span className="inline-block">
                <NumInput
                  value={formula.ratingWorkload}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setFormula({
                      ...formula,
                      ratingWorkload: e.target.valueAsNumber,
                    });
                  }}
                />{" "}
                * Workload{" "}
              </span>{" "}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
