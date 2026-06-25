import type { Report } from '../report.ts'
import { normalizeInstructorName } from './name-profile.ts'

export interface InstructorStats {
  criteria: Set<string>
  courseTerms: Set<string>
  courses: Set<string>
  subjects: Set<string>
  reportCount: number
  samples: number
}

export interface InstructorStatsResult {
  stats: Map<string, InstructorStats>
  sameReportPairs: Set<string>
}

/**
 * Produces an order-independent key for a pair of instructor names.
 *
 * The null character is used as a separator because it cannot appear in a
 * normal source name, so `['a', 'bc']` and `['ab', 'c']` cannot collide.
 *
 * @example
 * pairKey('IP, Ivan Chi Ho', 'IP, Chi Ho Ivan')
 * // => 'IP, Chi Ho Ivan\\0IP, Ivan Chi Ho'
 */
export function pairKey(nameA: string, nameB: string): string {
  return [nameA, nameB].sort().join('\0')
}

/**
 * Identifies the exact course offering that a report describes.
 *
 * @example
 * courseTermKey({ termCode: '2310', courseSubject: 'MATH', courseCode: '1014' } as Report)
 * // => '2310\\0MATH\\01014'
 */
export function courseTermKey(report: Report): string {
  return `${report.termCode}\0${report.courseSubject}\0${report.courseCode}`
}

/**
 * Identifies a course independent of term.
 *
 * @example
 * courseKey({ courseSubject: 'MATH', courseCode: '1014' } as Report)
 * // => 'MATH\\01014'
 */
export function courseKey(report: Report): string {
  return `${report.courseSubject}\0${report.courseCode}`
}

/**
 * Returns the mutable accumulator for one instructor, creating it when needed.
 *
 * @example
 * getStats(stats, 'IP, Ivan Chi Ho').samples
 * // => 0 before reports are accumulated
 */
function getStats(stats: Map<string, InstructorStats>, instructor: string): InstructorStats {
  let value = stats.get(instructor)
  if (!value) {
    value = {
      criteria: new Set(),
      courseTerms: new Set(),
      courses: new Set(),
      subjects: new Set(),
      reportCount: 0,
      samples: 0,
    }
    stats.set(instructor, value)
  }
  return value
}

/**
 * Builds the evidence used by the name matcher.
 *
 * `sameReportPairs` records pairs that appear together on one report. Those
 * pairs are treated as co-instructors and are not merged later.
 *
 * @example
 * const { stats, sameReportPairs } = buildInstructorStats(reports)
 * stats.get('IP, Ivan Chi Ho')?.courseTerms
 * // => Set { '2410\\0MATH\\01013', ... }
 * sameReportPairs.has(pairKey('CHAN, Alice', 'CHAN, Bob'))
 * // => true when both names appeared on the same report
 */
export function buildInstructorStats(reports: Report[]): InstructorStatsResult {
  const stats = new Map<string, InstructorStats>()
  const sameReportPairs = new Set<string>()

  for (const report of reports) {
    const instructors = Array.from(new Set(report.instructors.flatMap(normalizeInstructorName)))
    for (const instructor of instructors) {
      const instructorStats = getStats(stats, instructor)
      instructorStats.criteria.add(report.criterion)
      instructorStats.courseTerms.add(courseTermKey(report))
      instructorStats.courses.add(courseKey(report))
      instructorStats.subjects.add(report.courseSubject)
      instructorStats.reportCount += 1
      instructorStats.samples += report.samples
    }

    for (let i = 0; i < instructors.length; i++) {
      for (let j = i + 1; j < instructors.length; j++) {
        sameReportPairs.add(pairKey(instructors[i]!, instructors[j]!))
      }
    }
  }

  return { stats, sameReportPairs }
}

/**
 * Returns whether two instructor spellings ever taught the same exact course
 * offering.
 *
 * @example
 * hasCourseTermOverlap(statsA, statsB)
 * // => true when both have '2410\\0MATH\\01013'
 */
export function hasCourseTermOverlap(statsA: InstructorStats, statsB: InstructorStats): boolean {
  for (const courseTerm of statsA.courseTerms) {
    if (statsB.courseTerms.has(courseTerm)) return true
  }
  return false
}

/**
 * Counts the shared values between two sets.
 *
 * @example
 * overlapCount(new Set(['MATH', 'COMP']), new Set(['MATH']))
 * // => 1
 */
export function overlapCount<T>(valuesA: Set<T>, valuesB: Set<T>): number {
  let count = 0
  for (const value of valuesA) {
    if (valuesB.has(value)) count++
  }
  return count
}

/**
 * Requires repeated teaching evidence before merging a very short name with a
 * longer name.
 *
 * This is intentionally stricter than ordinary name matching because pairs
 * like `LAW, Anthony` and `LAW, Kwok Yung Anthony` can be real matches, but a
 * single shared offering is not enough evidence to decide automatically.
 *
 * @example
 * hasStrongTeachingFootprint(shortNameStats, longNameStats)
 * // => true when they share at least three exact course-term keys
 */
export function hasStrongTeachingFootprint(
  statsA: InstructorStats,
  statsB: InstructorStats,
): boolean {
  const sameCourseTerms = overlapCount(statsA.courseTerms, statsB.courseTerms)
  const sameCourses = overlapCount(statsA.courses, statsB.courses)
  const sameSubjects = overlapCount(statsA.subjects, statsB.subjects)

  return sameCourseTerms >= 3
    || (sameCourseTerms >= 2 && sameCourses >= 2)
    || (sameCourseTerms >= 2 && sameSubjects >= 1)
}
