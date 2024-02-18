'use client';

import {Input} from '@/components/ui/input';
import React, {type ChangeEvent} from 'react';
import {WindowVirtualizer} from 'virtua';
import {CourseCard} from '@/components/component/calendar/course-card';
import {courses, search} from '@/data/courses';
import {Button} from '@/components/ui/button';
import {HelpCircle} from 'lucide-react';
import {Collapsible, CollapsibleContent} from '@/components/ui/collapsible';

export default function Home() {
  const [query, setQuery] = React.useState('');
  const result = query === '' ? courses : search(query);

  const [showHelp, setShowHelp] = React.useState(false);

  return (
    <>
      <h1 className='max-w-sm lg:max-w-2xl text-7xl font-bold tracking-tighter text-logo-gradient'>
        UST Courses
      </h1>

      <section className='w-full max-w-sm lg:max-w-2xl items-center'>
        <div className='w-full flex gap-4 items-center'>
          <Input value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}

            className='rounded-full focus-visible:ring-gray-700 text-md h-12'
            placeholder='Search Courses by...' type='search'
          /> <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              setShowHelp(!showHelp);
            }}> <HelpCircle/> </Button>
        </div>

        <Collapsible open={showHelp}>
          <CollapsibleContent
            className='data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown'>
            <article className='p-8 pb-0 text-left'>
              <p>
                Search for courses by their name, code, instructors, room or section number.
              </p>
              <p>
                Features:
              </p>
              <ul>
                <li>Click (or tap) on sections to add them to calendar apps.</li>
                <li>Click (or tap) on rooms to find their location by Path Advisor.</li>
              </ul>
              <p>
                More features are coming soon!
              </p>
            </article>
          </CollapsibleContent> </Collapsible>
      </section>

      <div className='w-full max-w-sm lg:max-w-3xl px-2'>
        <WindowVirtualizer>
          {result.filter(it => it.sections.length).map(course => (
            <div key={`${course.program}${course.code}`} className='my-2'>
              <CourseCard course={course}/>
            </div>
          ))}
        </WindowVirtualizer>
      </div>
    </>
  );
}
