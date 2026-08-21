"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { RankingSearch } from "@/app/rankings/ranking-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  RANKING_CRITERIA,
  RANKING_CRITERION_LABELS,
} from "@/lib/rankings/configuration";
import { cn } from "@/lib/utils";

type Entity = "course" | "instructor";
type Preset = "learning" | "grade" | "custom";
type InitialControls = {
  activity: "current" | "all";
  commonCore: string[];
  course: string;
  prefix: string;
  preset: Preset;
  search: string;
  termCode: string;
  weights: Record<string, number>;
};

const criteria = RANKING_CRITERIA.map(
  (criterion) => [criterion, RANKING_CRITERION_LABELS[criterion]] as const,
);

export function RankingControls({
  categories,
  entity,
  initial,
  terms,
}: {
  categories: ReadonlyArray<{ value: string; label: string }>;
  entity: Entity;
  initial: InitialControls;
  terms: Array<{ termCode: string; termName: string }>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(searchParams.get("settings") === "open");
  const [isPending, startTransition] = useTransition();
  const [activity, setActivity] = useState(initial.activity);
  const [commonCore, setCommonCore] = useState(initial.commonCore);
  const [course, setCourse] = useState(initial.course);
  const [prefix, setPrefix] = useState(initial.prefix);
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [weights, setWeights] = useState(
    Object.fromEntries(
      criteria.map(([criterion]) => [
        criterion,
        String(initial.weights[criterion] ?? 0),
      ]),
    ),
  );

  function navigate(next: URLSearchParams) {
    next.delete("cursor");
    next.delete("pages");
    startTransition(() => {
      router.replace(`${pathname}?${next}`, { scroll: false });
    });
  }

  function applySettings() {
    const next = new URLSearchParams(searchParams.toString());
    setIsOpen(false);
    next.delete("settings");
    next.set("term", initial.termCode);
    next.set("preset", preset);
    next.set("activity", activity);
    if (prefix) next.set("prefix", prefix);
    else next.delete("prefix");
    if (entity === "instructor" && course) next.set("course", course);
    else next.delete("course");
    next.delete("commonCore");
    if (entity === "course")
      for (const category of commonCore) next.append("commonCore", category);
    for (const [criterion] of criteria) {
      const name = `weight_${criterion}`;
      if (preset === "custom") next.set(name, weights[criterion] ?? "0");
      else next.delete(name);
    }
    navigate(next);
  }

  function changeTerm(termCode: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("term", termCode);
    navigate(next);
  }

  function changeOpen(open: boolean) {
    setIsOpen(open);
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("settings", "open");
    else url.searchParams.delete("settings");
    window.history.replaceState(null, "", url);
  }

  return (
    <form action={pathname} className="flex w-full flex-col gap-4" method="get">
      <input name="preset" type="hidden" value={preset} />
      <div className="flex w-full items-center gap-4">
        <RankingSearch entity={entity} initialValue={initial.search} />
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
          <CardHeader className="p-4">
            <CollapsibleTrigger asChild>
              <Button
                aria-label="Ranking Settings"
                className="h-auto w-full justify-between p-0 hover:bg-transparent"
                type="button"
                variant="ghost"
              >
                Settings…
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "transition-transform motion-reduce:transition-none",
                    isOpen && "rotate-180",
                  )}
                  data-icon="inline-end"
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <Separator />
            <CardContent className="grid gap-6 p-4 md:grid-cols-2">
              <FieldSet>
                <FieldLegend>Filters</FieldLegend>
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="ranking-activity">Activity</FieldLabel>
                    <Select
                      defaultValue={activity}
                      name="activity"
                      onValueChange={(value: "current" | "all") =>
                        setActivity(value)
                      }
                    >
                      <SelectTrigger id="ranking-activity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="current">
                            Active in this Term
                          </SelectItem>
                          <SelectItem value="all">
                            Include historical or inactive
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="course-prefix">
                      {entity === "course"
                        ? "Course Prefix"
                        : "Taught Course Prefix"}
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      id="course-prefix"
                      maxLength={8}
                      name="prefix"
                      onChange={(event) => setPrefix(event.target.value)}
                      spellCheck={false}
                      value={prefix}
                    />
                  </Field>
                  {entity === "instructor" ? (
                    <Field>
                      <FieldLabel htmlFor="instructor-course">
                        Course Code
                      </FieldLabel>
                      <Input
                        autoComplete="off"
                        id="instructor-course"
                        maxLength={15}
                        name="course"
                        onChange={(event) => setCourse(event.target.value)}
                        spellCheck={false}
                        value={course}
                      />
                    </Field>
                  ) : null}
                  {entity === "course" ? (
                    <FieldSet>
                      <FieldLegend variant="label">
                        Current Common Core Categories
                      </FieldLegend>
                      <FieldGroup data-slot="checkbox-group" className="gap-2">
                        {categories.map((category) => (
                          <Field key={category.value} orientation="horizontal">
                            <Checkbox
                              checked={commonCore.includes(category.value)}
                              id={`common-core-${category.value}`}
                              name="commonCore"
                              onCheckedChange={(checked) =>
                                setCommonCore((selected) =>
                                  checked
                                    ? [...selected, category.value]
                                    : selected.filter(
                                        (value) => value !== category.value,
                                      ),
                                )
                              }
                              value={category.value}
                            />
                            <FieldLabel
                              htmlFor={`common-core-${category.value}`}
                            >
                              {category.label}
                            </FieldLabel>
                          </Field>
                        ))}
                      </FieldGroup>
                    </FieldSet>
                  ) : null}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>Score Formula</FieldLegend>
                <FieldGroup className="gap-4">
                  <FieldSet className="gap-3">
                    <FieldLegend variant="label">Ranking Preset</FieldLegend>
                    <ToggleGroup
                      aria-label="Ranking Preset"
                      className="grid grid-cols-1 sm:grid-cols-3"
                      onValueChange={(value: Preset) => {
                        if (value) setPreset(value);
                      }}
                      type="single"
                      value={preset}
                      variant="outline"
                    >
                      <ToggleGroupItem value="learning">
                        Knowledge-Focus&apos;d
                      </ToggleGroupItem>
                      <ToggleGroupItem value="grade">
                        Grading-Focus&apos;d
                      </ToggleGroupItem>
                      <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
                    </ToggleGroup>
                  </FieldSet>
                  {preset === "custom" ? (
                    <FieldSet>
                      <FieldLegend variant="label">
                        Custom Criterion Weights
                      </FieldLegend>
                      <FieldDescription>
                        Enter non-negative weights. They are normalized when
                        applied.
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
                                setWeights((current) => ({
                                  ...current,
                                  [criterion]: event.target.value,
                                }))
                              }
                              step="any"
                              type="number"
                              value={weights[criterion] ?? "0"}
                            />
                          </Field>
                        ))}
                      </FieldGroup>
                    </FieldSet>
                  ) : null}
                </FieldGroup>
              </FieldSet>

              <Button
                className="md:col-span-2"
                disabled={isPending}
                onClick={applySettings}
                type="button"
              >
                {isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Applying…
                  </>
                ) : (
                  "Apply Settings"
                )}
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </form>
  );
}
