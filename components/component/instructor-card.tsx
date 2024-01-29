import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {type Instructor} from '@/data';
import {Collapsible, CollapsibleContent} from '@/components/ui/collapsible';
import React from 'react';
import {InstructorRatingChart} from '@/components/component/instructor-rating-chart';

type InstructorCardProps = {
  instructor: Instructor;
};

type Color = [number, number, number];

function gradeColor(ratio: number): Color {
  const colorStops = [
    {ratio: 0.0, color: [237, 27, 47] as Color},
    {ratio: 0.25, color: [250, 166, 26] as Color},
    {ratio: 0.75, color: [163, 207, 98] as Color},
    {ratio: 1.0, color: [0, 154, 97] as Color},
  ];

  function lerp(start: number, end: number, t: number): number {
    return (start * (1 - t)) + (end * t);
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
      const t = (ratio - currentStop.ratio) / (nextStop.ratio - currentStop.ratio);
      return blendColors(currentStop.color, nextStop.color, t);
    }
  }

  return [0, 0, 0]; // Default color if the ratio is out of range
}

function cssColor(color: Color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

export function InstructorCard({instructor}: InstructorCardProps) {
  const [open, setOpen] = React.useState(false);

  const bgColor = gradeColor(instructor.percentile);

  const {ranking, score, name, samples, courses, grade} = instructor;
  const scoreFmt = (score * 100).toFixed(1);
  const coursesFmt = courses.map(it => `${it.program} ${it.code}`).join(', ');
  return (
    <Card
      className='bg-white flex flex-col cursor-pointer'
      onClick={() => {
        setOpen(!open);
      }}
    >
      <CardHeader className='flex flex-row gap-4 w-full items-center pr-10'>
        <CardTitle className='text-gray-600 shrink-0 w-36'>
          #{ranking} <span className='font-medium'>({scoreFmt})</span>
        </CardTitle>
        <div className='text-left min-w-0 space-y-1'>
          <CardTitle className='tracking-normal'>{name}</CardTitle>
          <CardDescription className='truncate'>{samples} Review(s). {coursesFmt}</CardDescription>
        </div>
        <Card className='!my-auto !ml-auto py-2 w-12 text-white shrink-0' style={{backgroundColor: cssColor(bgColor)}}>
          <CardTitle>{grade}</CardTitle>
        </Card>
      </CardHeader>
      <Collapsible open={open}>
        <CollapsibleContent
          className='overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown'>
          <CardContent>
            <div className='grid grid-cols-2 text-left ml-12 mr-6 text-gray-500 min-h-0'>
              <div className='grid grid-cols-2 grid-rows-4 gap-x-1'>
                <span className='text-right'>Rating (Teaching):</span>
                <span>{instructor.teachRating.toFixed(3)}</span>
                <span className='text-right'>Rating (Thumbs Up):</span>
                <span>{instructor.thumbRating.toFixed(3)}</span>
                <span className='text-right'>Overall Rating: </span>
                <span>{instructor.overallRating.toFixed(3)}</span>
                <span className='text-right'>Percentile: </span>
                <span>{(instructor.percentile * 100).toFixed(1)}%</span>
              </div>
              <div className='grid grid-rows-4 gap-x-1'>
                <span className='font-medium'>Courses (in 2023-24 Spring)</span>
                <div className='row-span-3 grid grid-rows-3 grid-cols-3'>
                  {instructor.courses.map(it => {
                    const str = `${it.program} ${it.code}`;
                    return <span key={str}>{str}</span>;
                  })}
                </div>
              </div>
            </div>
            <InstructorRatingChart thumbRatings={instructor.thumbRatings} teachRatings={instructor.teachRatings}/>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
