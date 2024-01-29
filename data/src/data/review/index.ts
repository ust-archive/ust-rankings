import { glob } from 'glob'
import { measure, termCode2Num, termName2Code } from '../utils.js'
import type { RawCourse, RawReview } from './type.js'
import type { Report, ReportMeta } from '../report.ts'
import { sum } from 'es-toolkit'

export async function load(): Promise<Report[]> {
  return await measure(async (timer) => {
    const files = await glob('data/review/data/**/*.json')
    const reports = (await Promise.all(files.map(file => loadFile(file)))).flat()
    const number = sum(reports.map(r => r.samples)) / 4 // 1 report has 4 criteria
    const time = timer()
    console.log(`Load Review: ${number} reports (${time} ms)`)
    return reports
  })
}

async function loadFile(file: string): Promise<Report[]> {
  const obj = await Bun.file(file).json() as {
    course: RawCourse
    reviews: RawReview[]
  }
  const { course, reviews } = obj
  return reviews.flatMap((review) => {
    const upvoteCount = review.upvote_count
    const downvoteCount = review.vote_count - upvoteCount
    const votes = upvoteCount - downvoteCount
    const meta = {
      termCode: termName2Code(review.semester),
      termNumber: termCode2Num(termName2Code(review.semester)),
      courseSubject: course.subject,
      courseCode: course.code,
      instructors: review.instructors.map(i => i.name),
      weight: (votes + 1) >= 0 ? (votes + 1) : 0,
      samples: 1,
    } satisfies ReportMeta
    return [
      {
        ...meta,
        criterion: 'content',
        rating: review.rating_content,
      },
      {
        ...meta,
        criterion: 'teaching',
        rating: review.rating_teaching,
      },
      {
        ...meta,
        criterion: 'grading',
        rating: review.rating_grading,
      },
      {
        ...meta,
        criterion: 'workload',
        rating: review.rating_workload,
      },
    ] satisfies Report[]
  })
}
