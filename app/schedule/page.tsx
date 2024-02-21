'use client';

import {Input} from '@/components/ui/input';
import React, {type ChangeEvent} from 'react';
import {WindowVirtualizer} from 'virtua';
import {CourseCard} from '@/components/component/calendar/course-card';
import {courses, searchCourses} from '@/data/schedule';
import {Button} from '@/components/ui/button';
import {CalendarPlus, Download, HelpCircle} from 'lucide-react';
import {Collapsible, CollapsibleContent} from '@/components/ui/collapsible';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {NewDomainBanner} from '@/components/component/new-domain-banner';

export default function Home() {
  const [shoppingCart, setShoppingCart] = React.useState<Set<number>>(new Set());

  const isSectionInShoppingCart = (section: number) => shoppingCart.has(section);

  const addSectionToShoppingCart = (section: number) => {
    shoppingCart.add(section);
    setShoppingCart(new Set(shoppingCart));
  };

  const removeSectionFromShoppingCart = (section: number) => {
    shoppingCart.delete(section);
    setShoppingCart(new Set(shoppingCart));
  };

  const [showHelp, setShowHelp] = React.useState(false);

  const [query, setQuery] = React.useState('');
  const queryResult = query === '' ? courses : searchCourses(query);

  return (
    <>
      <NewDomainBanner className='-mt-12 max-w-sm lg:max-w-2xl' />

      <h1 className='max-w-sm lg:max-w-2xl text-7xl font-bold tracking-tighter text-logo-gradient'>
        UST Schedule
      </h1>

      <section className='w-full max-w-sm lg:max-w-2xl items-center'>
        <div className='w-full flex gap-4 items-center'>
          <Input value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}

            className='rounded-full focus-visible:ring-gray-700 text-md h-12'
            placeholder='Search by...' type='search'
          />
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              setShowHelp(!showHelp);
            }}>
            <HelpCircle/>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              const params = new URLSearchParams([...shoppingCart].map(it => ['number', it.toString()]));
              window.open('/api/calendar?' + params.toString());
            }}>
            <Download/>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              const params = new URLSearchParams([...shoppingCart].map(it => ['number', it.toString()]));
              window.open(`webcal://${window.location.host}/api/calendar?` + params.toString());
            }}>
            <CalendarPlus/>
          </Button>
        </div>

        <Collapsible open={showHelp}>
          <CollapsibleContent
            className='overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown'>
            <article className='p-8 pb-0 text-left space-y-1'>
              <p>
                Search for courses by their name, code, instructors, room or section number.
              </p>
              <p>
                Features:
              </p>
              <ul>
                <li>
                  Click (or tap) on sections to add them to (or remove them from) the shopping cart.
                </li>
                <li>
                  Click (or tap) on the calendar icon to import the schedules in the shopping cart into the
                  calendar.
                </li>
                <li>
                  Click (or tap) on the download icon to download the schedules in the shopping cart to the device. You
                  can import the downloaded file into the calendar app manually.
                </li>
                <li>
                  Click (or tap) on rooms to find their location by Path Advisor.
                </li>
              </ul>
              <p>
                More features are coming soon...!
              </p>
            </article>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <section className='w-full max-w-sm lg:max-w-3xl px-2'>
        <Tabs className='w-full max-w-sm lg:max-w-3xl px-2' defaultValue='all'>
          <TabsList>
            <TabsTrigger value='all'>All</TabsTrigger>
            <TabsTrigger value='shopping-cart'>Shopping Cart</TabsTrigger>
          </TabsList>
          <TabsContent value='all'>
            <WindowVirtualizer>
              {queryResult
                .filter(it => it.sections.length)
                .map(course => (
                  <div key={`${course.program}${course.code}`} className='my-2'>
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
          <TabsContent value='shopping-cart' className='min-h-[200vh]'>
            <WindowVirtualizer>
              {queryResult
                .filter(it => it.sections.length)
                .filter(it => it.sections.some(section => shoppingCart.has(section.number)))
                .map(it => ({...it, sections: it.sections.filter(section => shoppingCart.has(section.number))}))
                .map(course => (
                  <div key={`${course.program}${course.code}`} className='my-2'>
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
