import { InstructorCourseLink } from "@/components/component/instructor-course-link";
import { InstructorRatingChart } from "@/components/component/instructor-rating-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { type CourseObject, type Instructor } from "@/data";
import { stopPropagation } from "@/lib/events";
import { naturalSort } from "@/lib/utils";
import React from "react";

type InstructorCardProps = {
  instructor: Instructor;
};

type Color = [number, number, number];

function gradeColor(ratio: number): Color {
  const colorStops = [
    { ratio: 0.0, color: [237, 27, 47] as Color },
    { ratio: 0.25, color: [250, 166, 26] as Color },
    { ratio: 0.75, color: [163, 207, 98] as Color },
    { ratio: 1.0, color: [0, 154, 97] as Color },
  ];

  function lerp(start: number, end: number, t: number): number {
    return start * (1 - t) + end * t;
  }

  function blendColors(color1: Color, color2: Color, t: number): Color {
    return [
      Math.round(lerp(color1[0], color2[0], t)),
      Math.round(lerp(color1[1], color2[1], t)),
      Math.round(lerp(color1[2], color2[2], t)),
    ];
  }

  for (let i = 0; i < colorStops.length - 1; i++) {
    const currentStop = colorStops[i];
    const nextStop = colorStops[i + 1];

    if (ratio >= currentStop.ratio && ratio <= nextStop.ratio) {
      const t =
        (ratio - currentStop.ratio) / (nextStop.ratio - currentStop.ratio);
      return blendColors(currentStop.color, nextStop.color, t);
    }
  }

  return [0, 0, 0]; // Default color if the ratio is out of range
}

function cssColor(color: Color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function formatCourse(it: CourseObject) {
  return `${it.subject} ${it.course}`;
}

export function InstructorCard({ instructor }: InstructorCardProps) {
  const [open, setOpen] = React.useState(false);

  const bgColor = gradeColor(instructor.percentile);

  const { ranking, score, name, samples, courses, grade } = instructor;

  const thisCourses = new Map(courses.map((it) => [formatCourse(it), it]));
  const allCourses = new Map([
    ...courses.map((it) => [formatCourse(it), it]),
    ...instructor.thumbRatings.map((it) => [
      formatCourse(it.course),
      it.course,
    ]),
    ...instructor.teachRatings.map((it) => [
      formatCourse(it.course),
      it.course,
    ]),
  ] as Array<[string, CourseObject]>);

  const scoreFmt = (score * 100).toFixed(1);
  const coursesFmt = [...allCourses.keys()].sort(naturalSort).join(", ");

  const [familyName, givenName] = name.split(", ");

  const googleUrl = new URL(
    "https://www.google.com/search?" +
      new URLSearchParams({
        q: `site:facultyprofiles.hkust.edu.hk ${name}`,
      }).toString(),
  ).toString();

  return (
    <Card
      className="flex cursor-pointer flex-col bg-white"
      onClick={() => {
        setOpen(!open);
      }}
    >
      <CardHeader className="flex w-full flex-row items-center gap-4 p-4 lg:p-6 lg:pr-10">
        <CardTitle className="shrink-0 text-gray-600 lg:w-36">
          #{ranking}{" "}
          <span className="hidden font-medium lg:inline">({scoreFmt})</span>
        </CardTitle>
        <div className="min-w-0 space-y-1 text-left">
          <CardTitle className="tracking-normal">
            <a
              className="group pointer-events-none lg:pointer-events-auto"
              href={googleUrl}
              target="_blank"
              onClick={stopPropagation}
            >
              <span className="inline-block group-hover:underline">
                {familyName},&nbsp;
              </span>
              <span className="inline-block group-hover:underline">
                {givenName}
              </span>
            </a>
          </CardTitle>
          <CardDescription className="truncate">
            {samples} Reviews of {coursesFmt}
          </CardDescription>
        </div>
        <Card
          className="!my-auto !ml-auto w-12 shrink-0 py-2 text-white"
          style={{ backgroundColor: cssColor(bgColor) }}
        >
          <CardTitle>{grade}</CardTitle>
        </Card>
      </CardHeader>
      <Collapsible open={open}>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
          <CardContent>
            <div className="mx-6 mb-1 hidden grid-cols-2 gap-2 text-left text-gray-500 lg:grid">
              <div className="grid auto-rows-min gap-x-2">
                <span className="text-right">Rating (Teaching):</span>
                <span className="col-start-2">
                  {instructor.teachRating.toFixed(3)}
                </span>
                <span className="text-right">Rating (Thumbs Up):</span>
                <span className="col-start-2">
                  {instructor.thumbRating.toFixed(3)}
                </span>
                <span className="text-right">Overall Rating: </span>
                <span className="col-start-2">
                  {instructor.overallRating.toFixed(3)}
                </span>
                <span className="text-right">Percentile: </span>
                <span className="col-start-2">
                  {(instructor.percentile * 100).toFixed(1)}%
                </span>
              </div>
              <div className="grid auto-rows-min gap-x-2">
                <span className="font-medium">
                  Courses{" "}
                  <span className="font-normal">
                    (A = Available this Semester)
                  </span>
                </span>
                <div className="grid grid-cols-2 gap-x-2">
                  {[...allCourses.keys()].sort(naturalSort).map((it) => (
                    <InstructorCourseLink
                      key={it}
                      course={allCourses.get(it)!}
                      thisSem={thisCourses.has(it)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-6 mb-1 grid gap-y-2 text-left text-gray-500 lg:hidden">
              <div className="grid gap-x-2">
                <span className="text-right">Rating (Teaching):</span>
                <span className="col-start-2">
                  {instructor.teachRating.toFixed(3)}
                </span>
                <span className="text-right">Rating (Thumbs Up):</span>
                <span className="col-start-2">
                  {instructor.thumbRating.toFixed(3)}
                </span>
                <span className="text-right">Overall Rating: </span>
                <span className="col-start-2">
                  {instructor.overallRating.toFixed(3)}
                </span>
                <span className="text-right">Percentile: </span>
                <span className="col-start-2">
                  {(instructor.percentile * 100).toFixed(1)}%
                </span>
              </div>
              <div className="grid gap-x-2">
                <span className="font-medium">Courses</span>
                <span className="font-normal">
                  (A = Available this Semester)
                </span>
                <div className="grid grid-cols-2 gap-x-2">
                  {[...allCourses.keys()].sort(naturalSort).map((it) => (
                    <InstructorCourseLink
                      key={it}
                      course={allCourses.get(it)!}
                      thisSem={thisCourses.has(it)}
                    />
                  ))}
                </div>
              </div>
              <a
                className="font-medium underline"
                href={googleUrl}
                target="_blank"
                onClick={stopPropagation}
              >
                Instructor Details
              </a>
            </div>

            <InstructorRatingChart
              thumbRatings={instructor.thumbRatings}
              teachRatings={instructor.teachRatings}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
