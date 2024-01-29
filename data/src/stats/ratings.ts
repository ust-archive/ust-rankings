/* eslint-disable @typescript-eslint/consistent-indexed-object-style */

import { intersection, uniq } from 'es-toolkit'
import type { Report } from '../data/report.ts'
import { bayesian } from './utils.ts'

export interface Ratings {
  [criterion: string]: {
    rating: {
      [term: string]: number
    }
    bayesian: {
      [term: string]: number
    }
    confidence: {
      [term: string]: number
    }
    samples: {
      [term: string]: number
    }
  }
}

export interface CourseRatings {
  meta: {
    /**
     * The course subject, e.g., "COMP".
     */
    subject: string
    /**
     * The course number, e.g., "1023".
     */
    code: string

    instructors: {
      [term: string]: string[]
    }
  }
  ratings: Ratings
}

export interface InstructorRatings {
  meta: {
    /**
     * The instructor's name.
     */
    name: string

    courses: {
      [term: string]: {
        subject: string
        code: string
      }[]
    }
  }
  ratings: Ratings
}

export interface CourseContext {
  termNumber: number
  currentInstructors: string[]
}

export interface InstructorContext {
  termNumber: number
}

export class RatingsMap<T> {
  #values: { [criterion: string]: { [term: string]: T } } = {}

  get(criterion: string, term: string): T | undefined {
    return this.#values[criterion]?.[term]
  }

  set(criterion: string, term: string, value: T): void {
    if (!this.#values[criterion]) {
      this.#values[criterion] = {}
    }
    this.#values[criterion][term] = value
  }

  criteria(): string[] {
    return Object.keys(this.#values)
  }

  terms(): string[] {
    const termsSet = new Set<string>()
    for (const criterion in this.#values) {
      for (const term in this.#values[criterion]) {
        termsSet.add(term)
      }
    }
    return Array.from(termsSet)
  }
}

export const confidence = {
  criteria: {
    instructor: function (instructors: string[], currentInstructors: string[]) {
      // Criterion - Instructors.
      // Given a term (from the context), we know the instructors of the course in that term.
      // If the report is about the same instructor(s), the confidence becomes 300% of the original confidence.
      // This is because the instructor has a significant impact on the course
      if (intersection(instructors, currentInstructors).length > 0) {
        return 3.0
      }
      return 1
    },
    timeliness: function (termNumber: number, currentTermNumber: number) {
      // Criterion - Timeliness:
      // The confidence becomes 75% of the original confidence for each 4 terms difference.
      // This is because the course may change over time, and the report may become less relevant.
      const termDifference = currentTermNumber - termNumber
      return Math.pow(1 - 0.25, termDifference / 4)
    },
  },
  course: function (review: Report, context: CourseContext) {
    return 1.0
      * confidence.criteria.instructor(review.instructors, context.currentInstructors)
      * confidence.criteria.timeliness(review.termNumber, context.termNumber)
  },
  instructor: function (review: Report, context: InstructorContext) {
    return 1.0
      * confidence.criteria.timeliness(review.termNumber, context.termNumber)
  },
}

export function calcBayesian(
  ratings: Ratings[],
) {
  const criteria = uniq(ratings.flatMap(it => Object.keys(it)))

  const nums = new RatingsMap<number>()
  const sumRating = new RatingsMap<number>()
  const sumConfidence = new RatingsMap<number>()

  for (const rating of ratings) {
    for (const criterion of criteria) {
      const r = rating[criterion]
      if (r) {
        const terms = Object.keys(r.rating)
        for (const term of terms) {
          if (isNaN(r.rating[term]!)) continue
          nums.set(criterion, term, (nums.get(criterion, term) ?? 0) + 1)
          sumRating.set(criterion, term, (sumRating.get(criterion, term) ?? 0) + r.rating[term]!)
          sumConfidence.set(criterion, term, (sumConfidence.get(criterion, term) ?? 0) + r.confidence[term]!)
        }
      }
    }
  }

  for (const criterion of nums.criteria()) {
    for (const term of nums.terms()) {
      const number = nums.get(criterion, term)!
      const avgRating = sumRating.get(criterion, term)! / number
      const avgConfidence = sumConfidence.get(criterion, term)! / number

      for (const rating of ratings) {
        const r = rating[criterion]
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
        if (r && r.rating[term] !== undefined) {
          r.bayesian[term] = bayesian(
            r.rating[term],
            r.confidence[term]!,
            avgRating,
            avgConfidence,
          )
        }
      }
    }
  }
}
