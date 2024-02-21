'use client';

import {Input} from '@/components/ui/input';
import {InstructorCard} from '@/components/component/instructor-card';
import {data, search} from '@/data';
import React, {type ChangeEvent} from 'react';
import {WindowVirtualizer} from 'virtua';
import {NewDomainBanner} from '@/components/component/new-domain-banner';

export default function Home() {
  const [query, setQuery] = React.useState('');
  const result = query === '' ? data : search(query);

  return (
    <>
      <NewDomainBanner className='-mt-12 max-w-sm lg:max-w-2xl' />

      <h1 className='max-w-sm lg:max-w-2xl text-7xl font-bold tracking-tighter text-logo-gradient'>
        UST Rankings
      </h1>
      <form className='w-full max-w-sm lg:max-w-2xl'>
        <Input value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value);
          }}

          className='rounded-full focus-visible:ring-gray-700 text-md h-12'
          placeholder='Search for instructors by Name / Course / etc...' type='search'
        />
      </form>
      <div className='w-full max-w-sm lg:max-w-3xl px-2'>
        <WindowVirtualizer>
          {result.map(instructor => (
            <div key={instructor.id} className='my-2'>
              <InstructorCard instructor={instructor}/>
            </div>
          ))}
        </WindowVirtualizer>
      </div>
    </>
  );
}
