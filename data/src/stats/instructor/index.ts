import { range, sortBy, sum, uniq, uniqBy } from 'es-toolkit'
import { reports } from '../../data'
import { allInstructors, average, currentTermNumber } from '../utils.js'
import { confidence, type InstructorRatings } from '../ratings.ts'

/**
 * Calculate the ratings of a course.
 */
function calcRatings(
  instructor: string,
): InstructorRatings {
  const courseReports = reports
    .filter(r => r.instructors.includes(instructor))
    .sort((r1, r2) => r1.termNumber - r2.termNumber)

  const minTerm = courseReports[0]!.termNumber

  const ratings: InstructorRatings = {
    meta: {
      name: instructor,
      courses: {},
    },
    ratings: {},
  }

  range(minTerm, currentTermNumber + 1).forEach((termNumber) => {
    const currentReports = courseReports.filter(r => r.termNumber === termNumber)
    let currentCourses = currentReports.map(it => ({
      subject: it.courseSubject,
      code: it.courseCode,
    }))
    currentCourses = uniqBy(currentCourses, ({ subject, code }) => `${subject} ${code}`)
    currentCourses = sortBy(currentCourses, ['subject', 'code'])

    ratings.meta.courses[termNumber] = currentCourses

    const reports = courseReports.filter(r => r.termNumber <= termNumber)
    const criteria = uniq(reports.map(r => r.criterion)).sort()

    criteria.forEach((criterion) => {
      if (criterion === 'x') return

      const criterionReports = reports.filter(r => r.criterion === criterion)
      const ratingVector = criterionReports.map(r => r.rating)
      const confidenceVector = criterionReports.map(r => r.weight * confidence.instructor(r, {
        termNumber,
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
  return allInstructors.map((instructor) => {
    return calcRatings(instructor)
  })
}
