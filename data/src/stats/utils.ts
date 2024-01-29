import * as mathjs from 'mathjs'
import { reports } from '../data'
import { uniq, uniqBy } from 'es-toolkit'
import { max } from 'es-toolkit/compat'

export function average(numbers: number[], weights: number[] = [1]): number {
  if (numbers.length === 0 || weights.length === 0) {
    return NaN
  }
  return mathjs.dot(numbers, weights) / mathjs.sum(weights)
}

export function bayesian(
  rating: number,
  confidence: number,
  avgNumber: number,
  avgConfidence: number,
) {
  return (
    (rating * confidence + avgNumber * avgConfidence)
    / (confidence + avgConfidence)
  )
}

export const allCourses = (() => {
  const courses = uniqBy(
    reports.map(it => ({
      subject: it.courseSubject,
      code: it.courseCode,
    })),
    c => `${c.subject}-${c.code}`,
  )
  return courses.sort((a, b) => a.subject.localeCompare(b.subject) || a.code.localeCompare(b.code))
})()

export const allInstructors = (() => {
  const instructors = uniq(reports.flatMap(it => it.instructors))
  return instructors.sort()
})()

export const allTermNumbers = (() => {
  const termNumbers = uniq(reports.map(review => review.termNumber))
  return termNumbers.sort((a, b) => a - b)
})()

export const currentTermNumber = max(allTermNumbers)!
