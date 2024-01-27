'use client';

import {Input} from '@/components/ui/input';
import {InstructorCard} from '@/components/component/instructor-card';
import {data, search} from '@/data';
import React, {type ChangeEvent} from 'react';
import {WindowVirtualizer} from 'virtua';

export default function Home() {
  const [query, setQuery] = React.useState('');
  const result = query === '' ? data : search(query);

  return (
    <>
      <h1 className='text-7xl font-bold tracking-tighter text-black'>
        UST Rankings
      </h1>
      <form className='w-full max-w-2xl '>
        <Input value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value);
          }}

          className='rounded-full focus-visible:ring-gray-700 text-md h-12'
          placeholder='Search for instructors by Name / Course / etc...' type='search'
        />
      </form>
      <div className='w-full max-w-3xl'>
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
