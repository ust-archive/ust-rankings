import type { RawCQ, RawTerm, RawTerms } from './type.js'
import { Type } from '@sinclair/typebox'
import { measure, termCode2Num } from '../utils.js'
import { uniq } from 'es-toolkit'
import type { Report } from '../report.ts'

export const CQ = Type.Object({
  id: Type.Optional(Type.String({ maxLength: 64 })),
  term: Type.String({ maxLength: 16 }),
  termName: Type.String(),
  termNumber: Type.Number({ minimum: 0, maximum: 99 * 4 + 3, multipleOf: 1 }),
  subject: Type.String({ maxLength: 8 }),
  number: Type.String({ maxLength: 8 }),
  instructors: Type.Array(Type.String()),
})

async function loadTerm(term: RawTerm) {
  const courses = await Bun.file(`data/cq/${term.term}.json`).json() as RawCQ
  return courses.map(course => ({
    termCode: term.term,
    termNumber: termCode2Num(term.term),
    courseSubject: course.subject,
    courseCode: course.number,
    instructors: uniq(
      course.classes
        .filter((clazz) => {
          const [type] = clazz.section.split(/\d+/)
          return type !== 'T' && type !== 'LA'
        })
        .flatMap(clazz =>
          clazz.schedule.flatMap(schedule => schedule.instructors),
        ),
    ),

    criterion: 'x',
    rating: 0,
    weight: 0,
    samples: 0,
  }) satisfies Report)
}

export async function load() {
  return measure(async (timer) => {
    const terms = await Bun.file('data/cq/terms.json').json() as RawTerms
    const reports = (await Promise.all(terms.map(term => loadTerm(term)))).flat()

    const number = reports.length
    const time = timer()

    console.log(`Load CQ: ${number} reports (${time} ms)`)
    return reports
  })
}
