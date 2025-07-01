import { Filter } from "@/app/course/filter";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CriteriaName } from "@/data/ratings";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import React from "react";

export type SettingsCardProps = {
  formula: string;
  setFormula: (formula: string) => void;

  filter: Filter;
  setFilter: (filter: Filter) => void;
};

export function SettingsCard({
  formula,
  setFormula,
  filter,
  setFilter,
}: SettingsCardProps) {
  return (
    <Card>
      <CardContent className="relative space-y-4 p-4">
        <Collapsible className="relative space-y-3">
          <CollapsibleTrigger className="flex w-full items-center">
            <div className="flex-grow text-left text-sm font-semibold hover:underline">
              Filter...
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="filter-offered-currently"
                    checked={!!filter.offeredCurrently}
                    onCheckedChange={(c) => {
                      setFilter({
                        ...filter,
                        offeredCurrently: !!c,
                      });
                    }}
                  />
                  <Label htmlFor="filter-cc-arts">
                    Offered in Current Term
                  </Label>
                </div>
              </div>
              <div className="text-sm font-semibold">
                Courses under 30-Credit Common Core Framework
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="filter-cc-arts"
                    checked={!!filter.ccArts}
                    onCheckedChange={(c) => {
                      setFilter({
                        ...filter,
                        ccArts: !!c,
                      });
                    }}
                  />
                  <Label htmlFor="filter-cc-arts">Arts (A)</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="filter-cc-humanities"
                    checked={!!filter.ccHumanities}
                    onCheckedChange={(c) => {
                      setFilter({
                        ...filter,
                        ccHumanities: !!c,
                      });
                    }}
                  />
                  <Label htmlFor="filter-cc-humanities">Humanities (H)</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="filter-cc-science"
                    checked={!!filter.ccScience}
                    onCheckedChange={(c) => {
                      setFilter({
                        ...filter,
                        ccScience: !!c,
                      });
                    }}
                  />
                  <Label htmlFor="filter-cc-science">Science (S)</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="filter-cc-technology"
                    checked={!!filter.ccTechnology}
                    onCheckedChange={(c) => {
                      setFilter({
                        ...filter,
                        ccTechnology: !!c,
                      });
                    }}
                  />
                  <Label htmlFor="filter-cc-technology">Technology (T)</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="filter-cc-social-analysis"
                    checked={!!filter.ccSocialAnalysis}
                    onCheckedChange={(c) => {
                      setFilter({
                        ...filter,
                        ccSocialAnalysis: !!c,
                      });
                    }}
                  />
                  <Label htmlFor="filter-cc-social-analysis">
                    Social Analysis (SA)
                  </Label>
                </div>
              </div>
            </div>
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger className="absolute right-0 top-0 m-0.5">
                  <QuestionMarkCircledIcon />
                </TooltipTrigger>
                <TooltipContent className="max-w-xl p-4 text-left">
                  <article>
                    <p>The formula of the score of the course.</p>
                    <p>
                      The formula is a JavaScript-like expression that
                      calculates the score for each course. You can use the
                      following variables for each criterion:
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
                        <code>.rating</code> - the average rating of the
                        criterion. In other words, it represents the simple
                        weighted average.
                      </li>
                      <li>
                        <code>.bayesian</code> - the Bayesian-adjusted rating of
                        the criterion. In other words, it represents the
                        Bayesian average, which considers the number of samples,
                        ensuring that the score is not skewed by a small number
                        of ratings.
                      </li>
                    </ul>
                    <p>
                      The preset formula is designed to reflect the quality of
                      the course itself. Therefore, the content and teaching
                      criteria weigh more heavily. The grading, on the other
                      hand, is restricted by the university itself, so it weighs
                      less. The workload is nothing to do with the quality of
                      the course, so it weighs only a little.
                    </p>
                    <p>
                      Of course, this is our own opinion. It might not fit your
                      own preference. You can always change the formula to your
                      own preference!
                    </p>
                  </article>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible className="relative space-y-3">
          <CollapsibleTrigger className="flex w-full items-center">
            <div className="flex-grow text-left text-sm font-semibold hover:underline">
              Score Formula...
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
            <Textarea
              style={{
                // @ts-expect-error I don't know why, fieldSizing is not recognized
                // but it actually works
                fieldSizing: "content",
              }}
              className="font-mono"
              defaultValue={formula}
              onChange={(e) => {
                setFormula(e.target.value);
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger className="absolute right-0 top-0 m-0.5">
                  <QuestionMarkCircledIcon />
                </TooltipTrigger>
                <TooltipContent className="max-w-xl p-4 text-left">
                  <article>
                    <p>The formula of the score of the course.</p>
                    <p>
                      The formula is a JavaScript-like expression that
                      calculates the score for each course. You can use the
                      following variables for each criterion:
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
                        <code>.rating</code> - the average rating of the
                        criterion. In other words, it represents the simple
                        weighted average.
                      </li>
                      <li>
                        <code>.bayesian</code> - the Bayesian-adjusted rating of
                        the criterion. In other words, it represents the
                        Bayesian average, which considers the number of samples,
                        ensuring that the score is not skewed by a small number
                        of ratings.
                      </li>
                    </ul>
                    <p>
                      The preset formula is designed to reflect the quality of
                      the course itself. Therefore, the content and teaching
                      criteria weigh more heavily. The grading, on the other
                      hand, is restricted by the university itself, so it weighs
                      less. The workload is nothing to do with the quality of
                      the course, so it weighs only a little.
                    </p>
                    <p>
                      Of course, this is our own opinion. It might not fit your
                      own preference. You can always change the formula to your
                      own preference!
                    </p>
                  </article>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
