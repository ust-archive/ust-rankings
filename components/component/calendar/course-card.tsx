import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type Course, CourseClass, CourseClassSchedule } from "@/data/cq";
import { PathAdvisor } from "@/data/cq/path-advisor";
import { cn } from "@/lib/utils";
import { DateTimeFormatter, LocalTime } from "@js-joda/core";
import React, { type ReactNode } from "react";
import { toast } from "sonner";

type Cell = {
  key: string | number;
  data: ReactNode;
  rowSpan: number;
  colSpan: number;
  remove: boolean;
  className: string;
};

function newCell(
  data: ReactNode,
  key: string | object,
  className?: string,
): Cell {
  return {
    key: typeof key === "string" ? key : JSON.stringify(key),
    data,
    rowSpan: 1,
    colSpan: 1,
    remove: false,
    className: className ?? "",
  };
}

function SectionCell(props: {
  course: Course;
  courseClass: CourseClass;
  selected: boolean;
  select: (section: string) => void;
  unselect: (section: string) => void;
}) {
  const [selected, setSelected] = React.useState(props.selected);
  const variant = selected ? "default" : "secondary";
  return (
    <Button
      className="h-full w-full"
      variant={variant}
      onClick={() => {
        setSelected(!selected);
        if (selected) {
          props.unselect(props.courseClass.number);
          toast(
            `${props.course.subject} ${props.course.number} ${props.courseClass.section} removed from shopping cart.`,
          );
        } else {
          props.select(props.courseClass.number);
          toast(
            `${props.course.subject} ${props.course.number} ${props.courseClass.section} added to shopping cart.`,
          );
        }
      }}
    >
      <span>{props.courseClass.section}</span>{" "}
      <span>({props.courseClass.number})</span>
    </Button>
  );
}

function InstructorsCell({ instructors }: { instructors: string[] }) {
  return (
    <>
      {instructors.map((i) => (
        <span className="block text-nowrap" key={i}>
          {i}
        </span>
      ))}
    </>
  );
}

function ScheduleCell({ schedule }: { schedule: CourseClassSchedule }) {
  const m = {
    0: "Su",
    1: "Mo",
    2: "Tu",
    3: "We",
    4: "Th",
    5: "Fr",
    6: "Sa",
  };
  const f = DateTimeFormatter.ofPattern("HH:mm");
  return (
    <>
      <span className="text-nowrap">
        {schedule.weekdays.map((day) => m[day]).join("")}{" "}
      </span>{" "}
      {schedule.fromTime && schedule.toTime && (
        <span className="text-nowrap">
          {LocalTime.parse(schedule.fromTime!).format(f)}-
          {LocalTime.parse(schedule.toTime!).format(f)}
        </span>
      )}
    </>
  );
}

function RoomCell({ venue }: { venue: string }) {
  function parse(input: string): {
    segments: string[];
    number?: number;
  } {
    const match = /(.*) \((\d+)\)/.exec(input);
    if (match) {
      const segments = match[1].split(", ");
      return {
        segments: segments.map((segment, index) =>
          index === segments.length - 1 ? segment : segment + ", ",
        ),
        number: parseInt(match[2], 10),
      };
    }

    const segments = input.split(", ");
    return {
      segments: segments.map((segment, index) =>
        index === segments.length - 1 ? segment : segment + ", ",
      ),
    };
  }

  const roomInfoEl = parse(venue).segments.map((segment) => (
    <span key={segment} className="text-nowrap">
      {segment}
    </span>
  ));

  const hrefPathAdvisor = PathAdvisor.findPathTo(venue);
  return (
    <div className="flex flex-col">
      <a href={hrefPathAdvisor} target="_blank" className="underline">
        {roomInfoEl}
      </a>
    </div>
  );
}

type SectionTableProps = {
  course: Course;
  courseClasses: CourseClass[];

  isSectionSelected: (section: string) => boolean;
  selectSection: (section: string) => void;
  unselectSection: (section: string) => void;
};

function SectionTable(props: SectionTableProps) {
  const { course, courseClasses } = props;

  const tableObj = courseClasses.flatMap((clazz) =>
    clazz.schedule.flatMap((schedule) => {
      const selected = props.isSectionSelected(clazz.number);
      return {
        key: JSON.stringify(clazz),
        cells: [
          newCell(
            <SectionCell
              course={course}
              courseClass={clazz}
              selected={selected}
              select={props.selectSection}
              unselect={props.unselectSection}
            />,
            clazz.number,
            "p-1",
          ),
          newCell(<ScheduleCell schedule={schedule} />, schedule),
          newCell(
            <InstructorsCell instructors={schedule.instructors} />,
            schedule.instructors,
          ),
          newCell(<RoomCell venue={schedule.venue} />, schedule.venue),
        ],
      };
    }),
  );

  const headerCell: Array<Cell | undefined> = tableObj[0]?.cells.map(
    () => undefined,
  );
  for (const row of tableObj) {
    const { cells } = row;

    for (let i = 0; i < cells.length; i++) {
      if (!headerCell[i] || cells[i].key !== headerCell[i]!.key) {
        headerCell[i] = cells[i];
      } else {
        headerCell[i]!.rowSpan++;
        cells[i].remove = true;
      }
    }
  }

  return (
    <table className="w-full table-auto overflow-auto border font-mono">
      <thead>
        <tr>
          <th className="p-2">Section</th>
          <th className="p-2">Schedule</th>
          <th className="p-2">Instructors</th>
          <th className="p-2">Room</th>
        </tr>
      </thead>
      <tbody>
        {/*
      h-0: fake height for the inner button to stretch to the height of the cell.
      See: https://stackoverflow.com/questions/3215553/make-a-div-fill-an-entire-table-cell
      */}
        {tableObj.map((row) => (
          <tr key={row.key} className="h-0">
            {row.cells.map((cell, i) => {
              if (cell.remove) {
                return null;
              }

              return (
                <td
                  className={cn("h-[inherit] border p-2", cell.className)}
                  key={i}
                  rowSpan={cell.rowSpan}
                  colSpan={cell.colSpan}
                >
                  {cell.data}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type CourseCardProps = {
  course: Course;

  isSectionSelected: (section: string) => boolean;
  selectSection: (section: string) => void;
  unselectSection: (section: string) => void;
};

export function CourseCard(props: CourseCardProps) {
  const { course } = props;
  return (
    <Card className="flex flex-col bg-white">
      <CardHeader className="flex w-full flex-row items-center gap-4 lg:p-6 lg:pr-10">
        <div className="min-w-0 space-y-1 text-left">
          <CardTitle className="tracking-normal">
            {course.subject} {course.number}
          </CardTitle>
          <CardDescription className="truncate">{course.name}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto bg-slate-50 dark:bg-slate-900">
          <SectionTable
            course={course}
            courseClasses={course.classes}
            isSectionSelected={props.isSectionSelected}
            selectSection={props.selectSection}
            unselectSection={props.unselectSection}
          />
        </div>
      </CardContent>
    </Card>
  );
}
