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
import { type RatingType, type SortBy } from "@/data/instructor";
import { stopPropagation } from "@/lib/events";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { type ChangeEvent, forwardRef } from "react";

export type SettingsCardProps = {
  sortBy: SortBy;
  setSortBy: (sortBy: SortBy) => void;

  formula: Record<RatingType, number>;
  setFormula: (ratingWeights: Record<RatingType, number>) => void;
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
                      Score: The overall score of the instructor, calculated by
                      the formula below.
                    </li>
                    <li>Content: The rating of the content in the reviews.</li>
                    <li>
                      Teaching: The rating of the teaching in the reviews.
                    </li>
                    <li>Grading: The rating of the grading in the reviews.</li>
                    <li>
                      Workload: The rating of the workload in the reviews.
                    </li>
                    <li>
                      Instructor: The rating of whether the instructor gets a
                      thumbs up in the reviews.
                    </li>
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
              <ToggleGroupItem value="bayesianRatingInstructor">
                Instructor
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
              <ToggleGroupItem value="ratingInstructor">
                Instructor (Abs)
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
                  <p>The formula of the score of the instructor.</p>
                  <p>
                    The preset formula is designed to reflect the score of the
                    instructor itself, rather than the courses that the
                    instructor teaches. Therefore, the teaching rating and the
                    instructor rating is given more weight in the formula, and
                    the content rating, grading rating, and workload rating is
                    given less weight.
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
              +
              <span className="inline-block">
                <NumInput
                  value={formula.ratingInstructor}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setFormula({
                      ...formula,
                      ratingInstructor: e.target.valueAsNumber,
                    });
                  }}
                />{" "}
                * Instructor{" "}
              </span>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
