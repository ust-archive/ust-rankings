'use client';

import {Input} from '@/components/ui/input';
import {InstructorCard} from '@/components/component/instructor-card';
import {data} from '@/data';
import React, {type ChangeEvent} from 'react';
import Fuse from 'fuse.js';
import {WindowVirtualizer} from 'virtua';

export default function Home() {
  const [search, setSearch] = React.useState('');
  const [fuse, _] = React.useState(new Fuse(data, {
    keys: ['name', 'courses', 'grade'],
    shouldSort: false,

    threshold: 0.3,
  }));

  const result = search === '' ? data : fuse.search(search).map(it => it.item);

  return (
    <>
      <h1 className='text-7xl font-bold tracking-tighter text-black'>
        HKUST Rankings
      </h1>
      <form className='w-full max-w-2xl '>
        <Input value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
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
