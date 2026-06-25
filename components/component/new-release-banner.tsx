"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { PartyPopper } from "lucide-react";
import { type HTMLAttributes } from "react";

type UstRankingsComBannerProps = HTMLAttributes<HTMLDivElement>;

export function NewReleaseBanner(props: UstRankingsComBannerProps) {
  return (
    <Alert {...props} className={cn("text-left", props.className)}>
      <PartyPopper className="h-4 w-4" />
      <AlertTitle>Bug Fixes...</AlertTitle>
      <AlertDescription>
        <article>
          <p>
            Hi there! We have just released a new version of UST Rankings with
            some long-lasting bug fixes. They used to cause the following
            issues:
          </p>
          <ul>
            <li>
              <strong>Invisible Rankings.</strong> Some rankings were not
              visible via search to users. We have fixed this issue. Now, all
              instructors who have taught / courses which have been offered for
              at least one term are now visible.
            </li>
            <li>
              <strong>Invisible Data Sources.</strong> Some data source, either
              ust.space or SFQ, was not visible to users in some rankings. We
              have fixed this issue.
            </li>
          </ul>
          <p>
            As said in the previous announcement, we are looking forward to
            improve UST Rankings by supporting users to leave a short review for
            courses and instructors. We are working on this feature and it will
            be available soon.
          </p>
          <p>
            As always, if you have any feedback or suggestions, please feel free
            to contact us at{" "}
            <a href="mailto:ust-rankings@flandia.dev">
              ust-rankings@flandia.dev
            </a>
            .
          </p>
          <p className="text-right">UST Rankings Team. June 26, 2026.</p>
        </article>
      </AlertDescription>
    </Alert>
  );
}
