"use client";

import { SisParserDialog } from "@/app/schedule/sis-parser-dialog";
import { CourseCard } from "@/components/component/calendar/course-card";
import { NewDomainBanner } from "@/components/component/new-domain-banner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cqTerms, searchCourses } from "@/data/cq";
import { cn } from "@/lib/utils";
import {
  CalendarPlus,
  Check,
  ChevronsUpDown,
  Download,
  HelpCircle,
} from "lucide-react";
import React, { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { WindowVirtualizer } from "virtua";

export default function Home() {
  const [term, setTerm] = useState(cqTerms.findLast(() => true)!.term);
  const [shoppingCart, setShoppingCart] = useState<Set<string>>(new Set());
  const [comboBoxOpen, setComboBoxOpen] = useState(false);

  const isSectionInShoppingCart = (section: string) =>
    shoppingCart.has(section);

  const addSectionToShoppingCart = (section: string) => {
    shoppingCart.add(section);
    setShoppingCart(new Set(shoppingCart));
  };

  const removeSectionFromShoppingCart = (section: string) => {
    shoppingCart.delete(section);
    setShoppingCart(new Set(shoppingCart));
  };

  const submitSisParserDialog = (classNumbers: string[]) => {
    classNumbers.forEach(addSectionToShoppingCart);
  };

  const [showHelp, setShowHelp] = React.useState(false);

  const [query, setQuery] = React.useState("");
  const queryResult = searchCourses(term, query);

  return (
    <>
      <NewDomainBanner className="-mt-12 max-w-sm lg:max-w-2xl" />

      <h1 className="text-logo-gradient max-w-sm text-7xl font-bold tracking-tighter lg:max-w-2xl">
        UST Schedule
      </h1>

      <section className="w-full max-w-sm items-center lg:max-w-2xl">
        <div className="flex w-full items-center gap-4">
          <Input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}
            className="text-md h-12 rounded-full focus-visible:ring-gray-700"
            placeholder="Search by..."
            type="search"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setShowHelp(!showHelp);
            }}
          >
            <HelpCircle />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const params = new URLSearchParams([
                ["term", term],
                ...[...shoppingCart].map((it) => ["number", it.toString()]),
              ]);
              window.open("/api/calendar?" + params.toString());
            }}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              const params = new URLSearchParams([
                ["term", term],
                ...[...shoppingCart].map((it) => ["number", it.toString()]),
              ]);
              const url =
                `webcal://${window.location.host}/api/calendar?` +
                params.toString();
              window.open(url);
              await navigator.clipboard.writeText(url);
              toast("The link is also copied to clipboard");
            }}
          >
            <CalendarPlus />
          </Button>
          <Popover open={comboBoxOpen} onOpenChange={setComboBoxOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={comboBoxOpen}
                className="w-[200px] justify-between"
              >
                {cqTerms.find((t) => t.term === term)?.termName}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
              <Command>
                <CommandInput placeholder="Search for term..." />
                <CommandList>
                  <CommandEmpty>No framework found.</CommandEmpty>
                  <CommandGroup>
                    {cqTerms.map((t) => (
                      <CommandItem
                        key={t.term}
                        value={t.term}
                        onSelect={(currentValue) => {
                          setTerm(currentValue);
                          setComboBoxOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            term === t.term ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {t.termName}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <Collapsible open={showHelp}>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
            <article className="space-y-1 p-8 pb-0 text-left">
              <p>
                Search for courses by their name, code, instructors, room or
                section number.
              </p>
              <p>Features:</p>
              <ul>
                <li>
                  Click (or tap) on sections to add them to (or remove them
                  from) the shopping cart.
                </li>
                <li>
                  Click (or tap) on the calendar icon to import the schedules in
                  the shopping cart into the calendar.
                </li>
                <li>
                  Click (or tap) on the download icon to download the schedules
                  in the shopping cart to the device. You can import the
                  downloaded file into the calendar app manually.
                </li>
                <li>
                  Click (or tap) on rooms to find their location by Path
                  Advisor.
                </li>
              </ul>
              <p>More features are coming soon...!</p>
            </article>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <section className="w-full max-w-sm px-2 lg:max-w-3xl">
        <Tabs className="w-full max-w-sm px-2 lg:max-w-3xl" defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="shopping-cart">Shopping Cart</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <WindowVirtualizer>
              {queryResult
                .filter((it) => it.classes.length)
                .map((course) => (
                  <div key={term + course.code} className="my-2">
                    <CourseCard
                      course={course}
                      isSectionSelected={isSectionInShoppingCart}
                      selectSection={addSectionToShoppingCart}
                      unselectSection={removeSectionFromShoppingCart}
                    />
                  </div>
                ))}
            </WindowVirtualizer>
          </TabsContent>
          <TabsContent value="shopping-cart" className="min-h-[200vh]">
            <SisParserDialog callback={submitSisParserDialog} term={term} />
            <hr className="mt-2" />
            <WindowVirtualizer>
              {searchCourses(term, "")
                .filter((it) => it.classes.length)
                .filter((it) =>
                  it.classes.some((section) =>
                    shoppingCart.has(section.number),
                  ),
                )
                .map((it) => ({
                  ...it,
                  sections: it.classes.filter((section) =>
                    shoppingCart.has(section.number),
                  ),
                }))
                .map((course) => (
                  <div key={term + course.code} className="my-2">
                    <CourseCard
                      course={course}
                      isSectionSelected={isSectionInShoppingCart}
                      selectSection={addSectionToShoppingCart}
                      unselectSection={removeSectionFromShoppingCart}
                    />
                  </div>
                ))}
            </WindowVirtualizer>
          </TabsContent>
        </Tabs>
      </section>
    </>
  );
}
