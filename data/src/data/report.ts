import * as mathjs from 'mathjs'
import { groupBy, mapValues } from 'es-toolkit'

/**
 * The meta information of a report.
 *
 * @see {@link Report}
 */
export interface ReportMeta {
  /**
   * The term code of the course.
   *
   * The term code is of the format `YYSS`,
   * where `YY` is the last two digits of the academic year and `SS` is the season number,
   * in which `10` represents Fall, `20` represents Winter, `30` represents Spring,
   * and `40` represents Summer.
   *
   * For example, `2310` represents 2023-24 Fall term.
   */
  termCode: string
  /**
   * The term number of the course.
   *
   * Different from term code,
   * this is a simple integer such that consecutive numbers represents consecutive terms.
   * The formula of term number is: 4 * (year - 2000) + season,
   * where season is 0 for Fall, 1 for Winter, 2 for Spring, and 3 for Summer.
   */
  termNumber: number

  /**
   * The subject of the course. For example, "COMP" for Computer Science.
   */
  courseSubject: string
  /**
   * The course code of the course. For example, "1023" as in "COMP 1023".
   */
  courseCode: string

  /**
   * The set of instructors teaching the course at the term.
   */
  instructors: string[]

  /**
   * The weight of the report, controlling how much this report contributes to the overall rating.
   */
  weight: number
  /**
   * The number of people who contributed the course. This is for displaying purposes only.
   *
   * Different from `weight` that `weight` can be `0` if the report is not used in the overall rating,
   * but `number` should usually be a positive integer representing the number of people who contributed to the report.
   */
  samples: number
}

/**
 * Report is an abstract representation of the rating of a course at a specific term,
 * taught by a specific set of instructors.
 */
export interface Report extends ReportMeta {
  /**
   * The criterion of the report.
   *
   * Different criteria are processed (normalized, etc.) differently.
   */
  criterion: string

  /**
   * The rating of the course on the criterion.
   */
  rating: number
}

export function standardize(reviews: Report[]): Report[] {
  const stats = mapValues(
    groupBy(reviews, review => review.criterion),
    (reviews) => {
      const ratings = reviews.map(r => r.rating)
      const mean = mathjs.mean(ratings)
      const std = mathjs.std(ratings, 'uncorrected')
      return {
        mean: Number(mean),
        std: Number(std),
      }
    },
  )

  return reviews.map(review => ({
    ...review,
    rating: (review.rating - stats[review.criterion]!.mean) / stats[review.criterion]!.std,
  }))
}
