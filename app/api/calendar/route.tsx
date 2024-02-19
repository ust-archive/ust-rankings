import {type NextRequest} from 'next/server';
import {sectionMap} from '@/data/schedule';
import * as ics from 'ics';
import {PathAdvisor} from '@/data/schedule/path-advisor';
import {generateEventAttributes} from '@/data/schedule/calendar-event';

export const dynamic = 'force-dynamic';

/**
 * GET: /api/calendar
 * Gets the iCalendar file for the given class (section) numbers.
 * Example: webcal://ust-rankings.vercel.app/api/calendar?number=1023&number=1024
 */
export async function GET(request: NextRequest) {
  const numbers = request.nextUrl.searchParams
    .getAll('number')
    .map(it => Number.parseInt(it, 10))
    .filter(it => !Number.isNaN(it));

  const webcal = Boolean(request.nextUrl.searchParams.get('webcal'));

  const sections = numbers.flatMap(it => sectionMap[it]);
  const event = ics.createEvents(sections.map(it => ({
    ...generateEventAttributes(it),
    description: `Path Advisor: ${PathAdvisor.findPathTo(it.room)!}`,
  })));

  if (event.error) {
    console.error(event.error);
    return new Response(event.error.message, {status: 500});
  }

  if (webcal) {
    return new Response(event.value, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
      },
    });
  }

  return new Response(event.value, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="calendar.ics"',
    },
  });
}
