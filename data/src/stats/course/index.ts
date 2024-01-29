import { range, sum, uniq } from 'es-toolkit'
import { reports } from '../../data'
import { allCourses, average, currentTermNumber } from '../utils.js'
import { confidence, type CourseRatings } from '../ratings.ts'

/**
 * Calculate the ratings of a course.
 */
function calcRatings(
  subject: string,
  code: string,
): CourseRatings {
  const courseReports = reports
    .filter(r => r.courseSubject === subject && r.courseCode === code)
    .sort((r1, r2) => r1.termNumber - r2.termNumber)

  const minTerm = courseReports[0]!.termNumber

  const ratings: CourseRatings = {
    meta: {
      subject,
      code,
      instructors: {},
    },
    ratings: {},
  }

  range(minTerm, currentTermNumber + 1).forEach((termNumber) => {
    const currentReports = courseReports.filter(r => r.termNumber === termNumber)
    const currentInstructors = uniq(currentReports.flatMap(r => r.instructors)).sort()
    ratings.meta.instructors[termNumber] = currentInstructors

    const reports = courseReports.filter(r => r.termNumber <= termNumber)
    const criteria = uniq(reports.map(r => r.criterion)).sort()

    criteria.forEach((criterion) => {
      if (criterion === 'x') return

      const criterionReports = reports.filter(r => r.criterion === criterion)
      const ratingVector = criterionReports.map(r => r.rating)
      const confidenceVector = criterionReports.map(r => r.weight * confidence.course(r, {
        termNumber,
        currentInstructors,
      }))

      const avgRating = average(ratingVector, confidenceVector)
      const sumConfidence = sum(confidenceVector)
      const sumSamples = sum(criterionReports.filter(r => r.termNumber === termNumber).map(r => r.samples))

      if (ratings.ratings[criterion]) {
        ratings.ratings[criterion].rating[termNumber] = avgRating
        ratings.ratings[criterion].confidence[termNumber] = sumConfidence
        ratings.ratings[criterion].samples[termNumber] = sumSamples
      }
      else {
        ratings.ratings[criterion] = {
          rating: { [termNumber]: avgRating },
          confidence: { [termNumber]: sumConfidence },
          samples: { [termNumber]: sumSamples },

          // the field bayesian is calculated later
          bayesian: {},
        }
      }
    })
  })

  return ratings
}

export function calc() {
  return allCourses.map(({ subject, code }) => {
    return calcRatings(subject, code)
  })
}
