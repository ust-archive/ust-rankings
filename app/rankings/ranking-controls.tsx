"use client";

import { Target } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { RankingSearch } from "@/app/rankings/ranking-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  RANKING_CRITERIA,
  RANKING_CRITERION_LABELS,
} from "@/lib/rankings/configuration";
import type {
  CommonCoreScheme,
  CommonCoreSchemeDefinition,
} from "@/lib/rankings/server";
import { withoutRankingPagination } from "@/lib/rankings/url";

type Entity = "course" | "instructor";
type Preset = "learning" | "grade" | "custom";
type InitialControls = {
  activity: "current" | "all";
  commonCore: string[];
  commonCoreScheme: CommonCoreScheme;
  preset: Preset;
  search: string;
  termCode: string;
  weights: Record<string, number>;
};
type Settings = {
  activity: "current" | "all";
  commonCore: string[];
  commonCoreScheme: CommonCoreScheme;
  preset: Preset;
  weights: Record<string, string>;
};

const criteria = RANKING_CRITERIA.map(
  (criterion) => [criterion, RANKING_CRITERION_LABELS[criterion]] as const,
);

export function RankingControls({
  entity,
  initial,
  schemes,
  terms,
}: {
  entity: Entity;
  initial: InitialControls;
  schemes: ReadonlyArray<CommonCoreSchemeDefinition>;
  terms: Array<{ termCode: string; termName: string }>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(searchParams.get("settings") === "open");
  const [isPending, startTransition] = useTransition();
  const [settings, setSettings] = useState<Settings>({
    activity: initial.activity,
    commonCore: initial.commonCore,
    commonCoreScheme: initial.commonCoreScheme,
    preset: initial.preset,
    weights: Object.fromEntries(
      criteria.map(([criterion]) => [
        criterion,
        String(initial.weights[criterion] ?? 0),
      ]),
    ),
  });
  const weightTimer = useRef<number | undefined>(undefined);
  const selectedScheme =
    schemes.find((scheme) => scheme.value === settings.commonCoreScheme) ??
    schemes[0];

  function navigate(nextSettings: Settings) {
    const next = withoutRankingPagination(window.location.search);
    next.delete("prefix");
    next.delete("course");
    next.set("term", initial.termCode);
    next.set("preset", nextSettings.preset);
    next.set("activity", nextSettings.activity);
    next.delete("commonCoreScheme");
    next.delete("commonCore");
    if (entity === "course") {
      next.set("commonCoreScheme", nextSettings.commonCoreScheme);
      for (const category of nextSettings.commonCore)
        next.append("commonCore", category);
    }
    for (const [criterion] of criteria) {
      const name = `weight_${criterion}`;
      if (nextSettings.preset === "custom")
        next.set(name, nextSettings.weights[criterion] ?? "0");
      else next.delete(name);
    }
    startTransition(() => {
      router.replace(`${pathname}?${next}`, { scroll: false });
    });
  }

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    navigate(next);
  }

  function updateWeight(criterion: string, value: string) {
    const weights = { ...settings.weights, [criterion]: value };
    setSettings((current) => ({ ...current, weights }));
    window.clearTimeout(weightTimer.current);
    weightTimer.current = window.setTimeout(
      () => navigate({ ...settings, weights }),
      300,
    );
  }

  function changeTerm(termCode: string) {
    const next = withoutRankingPagination(window.location.search);
    next.delete("prefix");
    next.delete("course");
    next.set("term", termCode);
    startTransition(() => {
      router.replace(`${pathname}?${next}`, { scroll: false });
    });
  }

  function changeOpen(open: boolean) {
    setIsOpen(open);
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("settings", "open");
    else url.searchParams.delete("settings");
    window.history.replaceState(null, "", url);
  }

  const currentActivityLabel =
    entity === "course" ? "Offered This Term" : "Teaching This Term";
  const entityLabel = entity === "course" ? "Courses" : "Instructors";

  return (
    <form action={pathname} className="flex w-full flex-col gap-4" method="get">
      <noscript>
        <input name="preset" type="hidden" value={settings.preset} />
        <input name="activity" type="hidden" value={settings.activity} />
        {entity === "course" ? (
          <input
            name="commonCoreScheme"
            type="hidden"
            value={settings.commonCoreScheme}
          />
        ) : null}
        {entity === "course"
          ? settings.commonCore.map((category) => (
              <input
                key={category}
                name="commonCore"
                type="hidden"
                value={category}
              />
            ))
          : null}
      </noscript>
      <div className="flex w-full items-center gap-4">
        <Field className="min-w-0 flex-1 gap-0">
          <FieldLabel className="sr-only" htmlFor="ranking-search">
            Search Rankings
          </FieldLabel>
          <RankingSearch entity={entity} initialValue={initial.search} />
        </Field>
        <Field className="w-[10.75rem] shrink-0 gap-0">
          <FieldLabel className="sr-only" htmlFor="ranking-term">
            Term
          </FieldLabel>
          <Select
            defaultValue={initial.termCode}
            name="term"
            onValueChange={changeTerm}
          >
            <SelectTrigger
              aria-label="Term"
              className="h-11 bg-white font-semibold"
              id="ranking-term"
            >
              <SelectValue placeholder="Latest Term" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {terms.map((term) => (
                  <SelectItem key={term.termCode} value={term.termCode}>
                    {term.termName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Card>
        <Collapsible onOpenChange={changeOpen} open={isOpen}>
          <CardHeader className="space-y-0 p-4">
            <CardTitle asChild className="text-sm">
              <CollapsibleTrigger asChild>
                <Button
                  aria-label="Settings"
                  className="h-auto w-full justify-start p-0 hover:bg-transparent"
                  type="button"
                  variant="ghost"
                >
                  Settings
                </Button>
              </CollapsibleTrigger>
            </CardTitle>
          </CardHeader>
          <CollapsibleContent>
            <Separator />
            <CardContent className="flex flex-col gap-6 p-5">
              <header className="flex flex-col items-center gap-1 text-center">
                <Target aria-hidden="true" />
                <h2 className="text-balance text-xl font-semibold">
                  Choose a Ranking Goal
                </h2>
                <p className="text-pretty text-sm text-gray-500">
                  Start with what you value, then refine the ranking population.
                </p>
              </header>

              <FieldSet>
                <FieldLegend className="sr-only">Ranking Preset</FieldLegend>
                <ToggleGroup
                  aria-label="Ranking Preset"
                  className="grid grid-cols-1 sm:grid-cols-3"
                  onValueChange={(value: Preset) => {
                    if (value) update({ preset: value });
                  }}
                  type="single"
                  value={settings.preset}
                  variant="outline"
                >
                  <ToggleGroupItem
                    className="h-auto min-h-20 flex-col items-start px-4 text-left"
                    value="learning"
                  >
                    <span>Knowledge-Focus&apos;d</span>
                    <span className="whitespace-normal text-xs font-normal text-gray-500">
                      Prioritize things learned.
                    </span>
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    className="h-auto min-h-20 flex-col items-start px-4 text-left"
                    value="grade"
                  >
                    <span>Grading-Focus&apos;d</span>
                    <span className="whitespace-normal text-xs font-normal text-gray-500">
                      Prioritize grading evidence.
                    </span>
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    className="h-auto min-h-20 flex-col items-start px-4 text-left"
                    value="custom"
                  >
                    <span>Custom</span>
                    <span className="whitespace-normal text-xs font-normal text-gray-500">
                      Set every criterion weight.
                    </span>
                  </ToggleGroupItem>
                </ToggleGroup>
              </FieldSet>

              {settings.preset === "custom" ? (
                <FieldSet>
                  <FieldLegend>Custom Criterion Weights</FieldLegend>
                  <FieldDescription>
                    Enter non-negative weights. They are normalized
                    automatically.
                  </FieldDescription>
                  <FieldGroup className="grid gap-3 sm:grid-cols-2">
                    {criteria.map(([criterion, label]) => (
                      <Field key={criterion}>
                        <FieldLabel htmlFor={`weight-${criterion}`}>
                          {label}
                        </FieldLabel>
                        <Input
                          autoComplete="off"
                          id={`weight-${criterion}`}
                          inputMode="decimal"
                          min="0"
                          name={`weight_${criterion}`}
                          onChange={(event) =>
                            updateWeight(criterion, event.target.value)
                          }
                          step="any"
                          type="number"
                          value={settings.weights[criterion] ?? "0"}
                        />
                      </Field>
                    ))}
                  </FieldGroup>
                </FieldSet>
              ) : null}

              <Separator />

              <FieldSet>
                <FieldLegend>Refine Results</FieldLegend>
                <FieldDescription>
                  Optional filters narrow the ranking population.
                </FieldDescription>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ranking-activity">
                      {entityLabel}
                    </FieldLabel>
                    <Select
                      name="activity"
                      onValueChange={(activity: "current" | "all") =>
                        update({ activity })
                      }
                      value={settings.activity}
                    >
                      <SelectTrigger id="ranking-activity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="current">
                            {currentActivityLabel}
                          </SelectItem>
                          <SelectItem value="all">All</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  {entity === "course" ? (
                    <Field>
                      <FieldLabel htmlFor="common-core-cohort">
                        Common Core Cohort
                      </FieldLabel>
                      <Select
                        name="commonCoreScheme"
                        onValueChange={(commonCoreScheme: CommonCoreScheme) =>
                          update({ commonCore: [], commonCoreScheme })
                        }
                        value={settings.commonCoreScheme}
                      >
                        <SelectTrigger id="common-core-cohort">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {schemes.map((scheme) => (
                              <SelectItem
                                key={scheme.value}
                                value={scheme.value}
                              >
                                {scheme.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                </FieldGroup>

                {entity === "course" && selectedScheme ? (
                  <FieldSet>
                    <FieldLegend variant="label">
                      Common Core Categories
                    </FieldLegend>
                    <FieldGroup className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {selectedScheme.categories.map((category) => (
                        <Field
                          className="gap-2"
                          key={category.value}
                          orientation="horizontal"
                        >
                          <Checkbox
                            checked={settings.commonCore.includes(
                              category.value,
                            )}
                            id={`common-core-${category.value}`}
                            name="commonCore"
                            onCheckedChange={(checked) => {
                              const commonCore = checked
                                ? [...settings.commonCore, category.value]
                                : settings.commonCore.filter(
                                    (value) => value !== category.value,
                                  );
                              update({ commonCore });
                            }}
                            value={category.value}
                          />
                          <FieldLabel
                            className="text-xs"
                            htmlFor={`common-core-${category.value}`}
                          >
                            {category.label}
                          </FieldLabel>
                        </Field>
                      ))}
                    </FieldGroup>
                  </FieldSet>
                ) : null}
              </FieldSet>

              <p aria-live="polite" className="sr-only">
                {isPending ? "Updating rankings…" : "Rankings updated."}
              </p>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </form>
  );
}
