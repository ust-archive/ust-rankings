import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import React, {type ReactNode} from 'react';
import {groupBy} from '@/lib/utils';
import {type Course, format, type Section, type SectionSchedule} from '@/data/schedule';
import {DateTimeFormatter, LocalTime} from '@js-joda/core';
import {PathAdvisor} from '@/data/schedule/path-advisor';
import {Button} from '@/components/ui/button';
import {toast} from 'sonner';

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

function SectionCell(props: {
  section: Section;
  selected: boolean;
  select: (section: number) => void;
  unselect: (section: number) => void;
}) {
  const [selected, setSelected] = React.useState(props.selected);
  const variant = selected ? 'default' : 'secondary';
  return <Button variant={variant} onClick={() => {
    setSelected(!selected);
    if (selected) {
      props.unselect(props.section.number);
      toast(`${format(props.section)} removed from shopping cart.`);
    } else {
      props.select(props.section.number);
      toast(`${format(props.section)} added to shopping cart.`);
    }
  }}>
    <span>{props.section.section}</span> <span>({props.section.number})</span>
  </Button>;
}

function InstructorsCell({instructors}: {instructors: string[]}) {
  return <>
    {instructors.map(i => <span className='block text-nowrap' key={i}>{i}</span>)}
  </>;
}

function ScheduleCell({schedule}: {schedule: SectionSchedule}) {
  const m = {
    MONDAY: 'Mon',
    TUESDAY: 'Tue',
    WEDNESDAY: 'Wed',
    THURSDAY: 'Thu',
    FRIDAY: 'Fri',
    SATURDAY: 'Sat',
    SUNDAY: 'Sun',
  };
  const f = DateTimeFormatter.ofPattern('HH:mm');
  return <>
    <span className='text-nowrap'>{m[schedule.day]} </span> <span
      className='text-nowrap'>{LocalTime.parse(schedule.start).format(f)}-{LocalTime.parse(schedule.end).format(f)}</span>
  </>;
}

function RoomCell({room}: {room: string}) {
  function parseRoomInfo(input: string): {
    segments: string[];
    number?: number;
  } {
    const match = /(.*) \((\d+)\)/.exec(input);
    if (match) {
      let segments = match[1].split(', ');
      segments = segments.map((segment, index) =>
        index === segments.length - 1 ? segment : segment + ', ',
      );
      return {
        segments,
        number: parseInt(match[2], 10),
      };
    }

    let segments = input.split(', ');
    segments = segments.map((segment, index) =>
      index === segments.length - 1 ? segment : segment + ', ',
    );
    return {
      segments,
    };
  }

  const roomInfoEl = parseRoomInfo(room)
    .segments
    .map(segment => <span key={segment} className='text-nowrap'>{segment}</span>);

  const hrefPathAdvisor = PathAdvisor.findPathTo(room);
  return <div className='flex flex-col'>
    {
      hrefPathAdvisor
        ? <a href={hrefPathAdvisor} target='_blank' className='underline'>{roomInfoEl}</a> : roomInfoEl
    }
  </div>;
}

type SectionTableProps = {
  sections: Section[];

  isSectionSelected: (section: number) => boolean;
  selectSection: (section: number) => void;
  unselectSection: (section: number) => void;
};

function SectionTable(props: SectionTableProps) {
  const {sections} = props;

  const sectionGroups = groupBy(sections, section => section.section);
  const tableObj = Object.entries(sectionGroups)
    .flatMap(([, sections]) => sections.flatMap(section => {
      const selected = props.isSectionSelected(section.number);
      return ({
        key: JSON.stringify(section),
        cells: [
          newCell(<SectionCell
            section={section}
            selected={selected}
            select={props.selectSection}
            unselect={props.unselectSection}
          />, section.number),
          newCell(<ScheduleCell schedule={section.schedule}/>, section.schedule),
          newCell(<InstructorsCell instructors={section.instructors}/>, section.instructors),
          newCell(<RoomCell room={section.room}/>, section.room),
        ],
      });
    }));

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
        <th className='p-2'>Section</th>
        <th className='p-2'>Schedule</th>
        <th className='p-2'>Instructors</th>
        <th className='p-2'>Room</th>
      </tr>
    </thead>
    <tbody>
      {tableObj.map(row => <tr key={row.key} className=''>
        {row.cells.map((cell, i) => {
          if (cell.remove) {
            return null;
          }

          return <td className='border p-2' key={i} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
            {cell.data}
          </td>;
        })}
      </tr>)}
    </tbody>
  </table>;
}

type CourseCardProps = {
  course: Course;

  isSectionSelected: (section: number) => boolean;
  selectSection: (section: number) => void;
  unselectSection: (section: number) => void;
};

export function CourseCard(props: CourseCardProps) {
  const {course} = props;
  return (
    <Card className='bg-white flex flex-col'>
      <CardHeader
        className='flex flex-row gap-4 w-full items-center lg:p-6 lg:pr-10'>
        <div className='text-left min-w-0 space-y-1'>
          <CardTitle className='tracking-normal'>
            {course.name}
          </CardTitle>
          <CardDescription className='truncate'>{course.program} {course.code}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className='overflow-auto bg-slate-50'>
          <SectionTable
            sections={course.sections}
            isSectionSelected={props.isSectionSelected}
            selectSection={props.selectSection}
            unselectSection={props.unselectSection}
          />
        </div>
      </CardContent>
    </Card>
  );
}
