"use client";

import { SisParserDialog } from "@/app/schedule/sis-parser-dialog";
import { CourseCard } from "@/components/component/calendar/course-card";
import { NewReleaseBanner } from "@/components/component/new-release-banner";
import { TermSelect } from "@/components/component/term-select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cqTerms, searchCourses } from "@/data/cq";
import { CalendarPlus, Download, HelpCircle } from "lucide-react";
import React, { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { WindowVirtualizer } from "virtua";

export default function Home() {
  const [term, setTerm] = useState(cqTerms.findLast(() => true)!.term);
  const [shoppingCart, setShoppingCart] = useState<Set<string>>(new Set());

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
      <NewReleaseBanner className="-mt-12" />

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
          <TermSelect term={term} onTermChange={setTerm} />
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
