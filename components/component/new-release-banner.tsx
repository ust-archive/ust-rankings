"use client";

import { Reaction } from "@/components/component/reaction";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { PartyPopper } from "lucide-react";
import { type HTMLAttributes } from "react";

type UstRankingsComBannerProps = HTMLAttributes<HTMLDivElement>;

export function NewReleaseBanner(props: UstRankingsComBannerProps) {
  return (
    <Alert {...props} className={cn("text-left", props.className)}>
      <PartyPopper className="h-4 w-4" />
      <AlertTitle>New UST Rankings!</AlertTitle>
      <AlertDescription>
        <article>
          <p>
            Hi there! We have just released a new version of UST Rankings with
            some exciting features:
          </p>
          <ul>
            <li>
              <strong>New Ranking Algorithm.</strong> We have improved the
              ranking algorithm to provide more accurate and reliable rankings.
              <Reaction
                id="announcement.new-ranking-algorithm"
                className="mb-2 mt-0.5"
              />
            </li>
            <li>
              <strong>New Data Source: SFQ.</strong> We have introduced a new
              ranking data source, the official Student Feedback Questionnaire
              (SFQ). We hope that this will provide a more comprehensive view of
              the instructors and courses.
              <Reaction
                id="announcement.new-data-source-sfq"
                className="mb-2 mt-1"
              />
            </li>
            <li>
              <strong>Support Course Filtering.</strong> We have supported to
              filter the courses by their attributes, such as showing only the
              courses that are offered in the current term, or only the common
              core courses.
              <Reaction
                id="announcement.support-course-filtering"
                className="mb-2 mt-1"
              />
            </li>
          </ul>
          <p>
            We are also planning to add more features in the future, but we need
            your opinion!
          </p>
          <ul>
            <li>
              <strong>Adding Review.</strong> We are considering adding a
              feature that allows users to leave short reviews for instructors
              and courses. Different from ust.space, we plan to only allow short
              reviews of a few sentences, so to grab a quick overview of the
              instructor or course. Perhaps, we would support emoji reaction
              just like what we have here.
              <Reaction id="announcement.adding-review" className="mb-2 mt-1" />
            </li>
          </ul>
          <p>
            We hope that you will enjoy the new features and improvements. As
            always, if you have any feedback or suggestions, please feel free to
            contact us.
          </p>
          <p className="text-right">UST Rankings Team. July 1, 2025.</p>
          <Reaction id="announcement" variant="full" />
        </article>
      </AlertDescription>
    </Alert>
  );
}
