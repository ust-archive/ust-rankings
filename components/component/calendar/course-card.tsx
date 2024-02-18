import * as ics from 'ics';
import {saveAs} from 'file-saver';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import React, {type ReactNode} from 'react';
import {groupBy} from '@/lib/utils';
import {stopPropagation} from '@/lib/events';
import {type Course, eventAttrFrom, type Section, type SectionSchedule, toPathAdvisorName} from '@/data/courses';
import {DateTimeFormatter, LocalTime} from '@js-joda/core';

type CourseCardProps = {
  course: Course;
};

type Cell = {
  key: string | number;
  data: ReactNode;
  rowSpan: number;
  colSpan: number;
  remove: boolean;
};

function newCell(data: ReactNode, key: string | any, rowSpan?: number, colSpan?: number): Cell {
  return {
    key: typeof key === 'string' ? key : JSON.stringify(key),
    data,
    rowSpan: rowSpan ?? 1,
    colSpan: colSpan ?? 1,
    remove: false,
  };
}

function Sect({section, course}: {section: Section; course: Course}) {
  function saveIcs() {
    const eventAttrs = course.sections
      .filter(s => s.number === section.number)
      .map(s => eventAttrFrom(course, s));

    const icsStr = ics.createEvents(eventAttrs).value!;
    const blob = new Blob([icsStr], {type: 'text/courses;charset=utf-8'});
    saveAs(blob, `${course.program}${course.code}-${section.section}.ics`);
  }

  return <div className='flex flex-col'>
    <a
      className='cursor-pointer underline'
      onClick={() => {
        saveIcs();
      }}> <span>{section.section}</span> <span>({section.number})</span> </a>
  </div>;
}

function Intr({instructors}: {instructors: string[]}) {
  return <div className='flex flex-col'>
    {instructors.map(i => <span className='block text-nowrap' key={i}>{i}</span>)}
  </div>;
}

function Sch({schedule}: {schedule: SectionSchedule}) {
  const m = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    MONDAY: 'Mon',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    TUESDAY: 'Tue',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    WEDNESDAY: 'Wed',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    THURSDAY: 'Thu',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    FRIDAY: 'Fri',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SATURDAY: 'Sat',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SUNDAY: 'Sun',
  };
  const f = DateTimeFormatter.ofPattern('HH:mm');
  return <>
    <span className='text-nowrap'>{m[schedule.day]} </span> <span
      className='text-nowrap'>{LocalTime.parse(schedule.start).format(f)}-{LocalTime.parse(schedule.end).format(f)}</span>
  </>;
}

function Room({room}: {room: string}) {
  function parseRoomInfo(input: string): {
    segments: string[];
    number?: number;
  } {
    const match = /(.*) \((\d+)\)/.exec(input);
    if (match) {
      let segments = match[1].split(', ');
      segments = segments.map((segment, index) =>
        index === segments.length - 1 ? segment : segment + ',',
      );
      return {
        segments,
        number: parseInt(match[2], 10),
      };
    }

    let segments = input.split(', ');
    segments = segments.map((segment, index) =>
      index === segments.length - 1 ? segment : segment + ',',
    );
    return {
      segments,
    };
  }

  const paName = toPathAdvisorName(room);
  const url = `https://pathadvisor.ust.hk/interface.php?roomno=${paName}`;

  const roomInfoEl = parseRoomInfo(room).segments.map(segment => <span key={segment}
    className='text-nowrap'>{segment}</span>);

  return <div className='flex flex-col'>
    {
      paName ? <a href={url} target='_blank' className='underline'>{roomInfoEl}</a> : roomInfoEl
    }
  </div>;
}

function SectionTable({sections, course}: {sections: Section[]; course: Course}) {
  const sectionGroups = groupBy(sections, section => section.section);
  const tableObj = Object.entries(sectionGroups).flatMap(([, sections]) => sections.flatMap(sectionObj => ({
    cells: [
      newCell(<Sect section={sectionObj} course={course}/>, sectionObj.number),
      newCell(<Sch schedule={sectionObj.schedule}/>, sectionObj.schedule),
      newCell(<Intr instructors={sectionObj.instructors}/>, sectionObj.instructors),
      newCell(<Room room={sectionObj.room}/>, sectionObj.room),
    ],
  })));

  const headerCell: Array<Cell | undefined> = tableObj[0]?.cells.map(() => undefined);
  for (const row of tableObj) {
    const {cells} = row;

    for (let i = 0; i < cells.length; i++) {
      if (!headerCell[i] || cells[i].key !== headerCell[i]!.key) {
        headerCell[i] = cells[i];
      } else {
        headerCell[i]!.rowSpan++;
        cells[i].remove = true;
      }
    }
  }

  return <table className='w-full table-auto border font-mono overflow-auto'>
    <thead>
      <tr>
        <th className='px-2'>Section</th>
        <th className='px-2'>Schedule</th>
        <th className='px-2'>Instructors</th>
        <th className='px-2'>Room</th>
      </tr>
    </thead>
    <tbody>
      {tableObj.map((row, i) => <tr key={i} className=''>
        {row.cells.map((cell, j) => {
          if (cell.remove) {
            return null;
          }

          return <td className='border px-4 py-2' key={j} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{cell.data}</td>;
        })}
      </tr>)}
    </tbody>
  </table>;
}

export function CourseCard({course}: CourseCardProps) {
  const url = `https://w5.ab.ust.hk/wcq/cgi-bin/2330/subject/${course.program}#${course.program}${course.code}`;

  return (
    <Card className='bg-white flex flex-col'> <CardHeader
      className='flex flex-row gap-4 w-full items-center p-4 lg:p-6 lg:pr-10'>
      <div className='text-left min-w-0 space-y-1'>
        <CardTitle className='tracking-normal'> <a className='group pointer-events-none lg:pointer-events-auto'
          href={url} target='_blank' onClick={stopPropagation}>
          {course.name}
        </a> </CardTitle> <CardDescription className='truncate'>{course.program} {course.code}</CardDescription>
      </div>
    </CardHeader>

    <CardContent>
      <div className='overflow-auto bg-slate-50'>
        <SectionTable sections={course.sections} course={course}/>
      </div>
    </CardContent> </Card>
  );
}
