import { glob } from 'glob'
import { measure, termCode2Num } from '../utils.js'
import { AssertError, Value } from '@sinclair/typebox/value'
import { round, sum } from 'es-toolkit'
import {
  InstructorLevelOfStatistics,
  SFQInstructorReport,
  type SFQReport,
} from './type.ts'
import type { Report, ReportMeta } from '../report.ts'

function term2Code(year: number, term: 'FALL' | 'SPRING' | 'WINTER' | 'SUMMER'): string {
  const yearString = year.toString().slice(0, 2)
  const season = {
    FALL: '10',
    WINTER: '20',
    SPRING: '30',
    SUMMER: '40',
  }[term]
  return yearString + season
}

async function loadFile(file: string) {
  // Just assert the type for now. The type is enforced later.
  const objs = (await Bun.file(file).json() as SFQReport[])
    // Filter out reports with no responses.
    .filter(obj => obj.responseRate > 0)
    .map((obj) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-argument
      const termCode = term2Code((obj as any).year, (obj as any).term)
      return ({
        ...obj,
        termCode,
        termNumber: termCode2Num(termCode),
      })
    })

  const instructorReports = objs
    // Get the instructor reports.
    .filter(obj => obj.levelOfStatistics === InstructorLevelOfStatistics)
    // Some instructor reports are really dummy ones.
    // They have no instructor name or instructor overall mean.
    .filter(obj => obj.courseOverallMean)
    .filter(obj => obj.instructorOverallMean)

    .flatMap((obj) => {
      try {
        return [Value.Parse(SFQInstructorReport, obj)]
      }
      catch (e) {
        if (e instanceof AssertError) {
          console.warn(
            `Error: Load ${file} in ${obj.surveyName} at ${e.error!.path}: ${e.error!.message}`,
          )
          return []
        }
        throw e
      }
    })

  const reports = instructorReports.flatMap((ir) => {
    const meta = {
      termCode: ir.termCode,
      termNumber: ir.termNumber,

      courseSubject: ir.courseGroup,
      courseCode: ir.courseNumber,

      instructors: ir.instructorName ? [ir.instructorName] : [],
      weight: (ir.enrollment * ir.responseRate) * ir.responseRate,
      samples: round(ir.enrollment * ir.responseRate),
    } satisfies ReportMeta
    return [
      {
        ...meta,
        criterion: 'course',
        rating: ir.courseOverallMean,
      },
      {
        ...meta,
        criterion: 'instructor',
        rating: ir.instructorOverallMean,
      },
    ] satisfies Report[]
  })
  return reports
}

export async function load() {
  return await measure(async (timer) => {
    const files = await glob('data/sfq/*.json')
    const reports = (await Promise.all(files.map(file => loadFile(file)))).flat()
    const number = sum(reports.map(r => r.samples)) / 2 // 1 report has 2 ratings (course and instructor)
    const time = timer()
    console.log(`Load SFQ: ${number} reports (${time} ms)`)
    return reports
  })
}
