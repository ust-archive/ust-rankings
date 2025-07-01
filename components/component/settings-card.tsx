import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import React, { ReactNode } from "react";

export type SettingsCardProps = {
  formula: string;
  setFormula: (formula: string) => void;

  tooltip: ReactNode;
};

export function SettingsCard({
  formula,
  setFormula,
  tooltip,
}: SettingsCardProps) {
  return (
    <Card>
      <CardContent className="relative space-y-2 p-4">
        <Collapsible className="space-y-2">
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
                <TooltipTrigger className="absolute right-0 top-0 m-4">
                  <QuestionMarkCircledIcon />
                </TooltipTrigger>
                <TooltipContent className="max-w-xl p-4 text-left">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
