import type { Report } from './report.ts'
import { DisjointSet } from '../utils/disjoint-set.ts'
import {
  type NameProfile,
  normalizeInstructorName,
  parseInstructorName,
} from './instructor-name/name-profile.ts'
import {
  type InstructorStats,
  buildInstructorStats,
  hasCourseTermOverlap,
  hasStrongTeachingFootprint,
  pairKey,
} from './instructor-name/teaching-footprint.ts'

/**
 * Returns whether two given-name tokens are compatible.
 *
 * Single-letter tokens are treated as initials.
 *
 * @example
 * tokenMatches('c', 'chi')
 * // => true
 *
 * @example
 * tokenMatches('ivan', 'chi')
 * // => false
 */
function tokenMatches(tokenA: string, tokenB: string): boolean {
  return tokenA === tokenB
    || (tokenA.length === 1 && tokenB.startsWith(tokenA))
    || (tokenB.length === 1 && tokenA.startsWith(tokenB))
}

/**
 * Checks ordered given-name compatibility.
 *
 * This catches full-name/initial variants without allowing a one-token prefix
 * to match a long name by itself.
 *
 * @example
 * hasOrderedTokenMatch(parseInstructorName('IP, I C H')!, parseInstructorName('IP, Ivan Chi Ho')!)
 * // => true
 *
 * @example
 * hasOrderedTokenMatch(parseInstructorName('IP, Ivan')!, parseInstructorName('IP, Ivan Chi Ho')!)
 * // => false
 */
function hasOrderedTokenMatch(profileA: NameProfile, profileB: NameProfile): boolean {
  const minLength = Math.min(profileA.givenTokens.length, profileB.givenTokens.length)
  if (minLength === 0) return false

  for (let i = 0; i < minLength; i++) {
    if (!tokenMatches(profileA.givenTokens[i]!, profileB.givenTokens[i]!)) {
      return false
    }
  }

  return profileA.givenTokens.length === profileB.givenTokens.length || minLength >= 2
}
/**
 * Counts shared exact tokens.
 *
 * @example
 * sharedTokenCount(['chi', 'ho', 'ivan'], ['ivan', 'chi'])
 * // => 2
 */
function sharedTokenCount(tokensA: string[], tokensB: string[]): number {
  const tokensBSet = new Set(tokensB)
  return tokensA.filter(token => tokensBSet.has(token)).length
}

/**
 * Scores whether two parsed names should be linked.
 *
 * Larger scores are processed first. Returning `undefined` means the two names
 * do not have enough evidence to merge automatically.
 *
 * @example
 * linkScore(parseInstructorName('IP, Ivan Chi Ho')!, parseInstructorName('IP, Chi Ho Ivan')!, statsA, statsB)
 * // => 95 when they share an exact course-term, 85 otherwise
 *
 * @example
 * linkScore(parseInstructorName('LAW, Anthony')!, parseInstructorName('LAW, Kwok Yung Anthony')!, statsA, statsB)
 * // => undefined unless the teaching footprint is repeated and strong
 */
function linkScore(
  profileA: NameProfile,
  profileB: NameProfile,
  statsA: InstructorStats,
  statsB: InstructorStats,
): number | undefined {
  if (profileA.family !== profileB.family) return undefined

  const hasOverlap = hasCourseTermOverlap(statsA, statsB)

  if (hasOrderedTokenMatch(profileA, profileB)) {
    return 100
  }

  const minGivenTokens = Math.min(profileA.givenTokens.length, profileB.givenTokens.length)
  const sharedGivenTokens = sharedTokenCount(profileA.givenTokens, profileB.givenTokens)
  if (hasOverlap && minGivenTokens >= 2 && sharedGivenTokens === minGivenTokens) {
    return 90
  }
  if (
    minGivenTokens === 1
    && sharedGivenTokens === 1
    && hasStrongTeachingFootprint(statsA, statsB)
  ) {
    return 70
  }

  if (profileA.sortedGivenKey !== profileB.sortedGivenKey) {
    return undefined
  }

  const tokenCount = profileA.givenTokens.length
  if (tokenCount >= 3) {
    return hasOverlap ? 95 : 85
  }

  if (hasOverlap) {
    return 75
  }

  return undefined
}

/**
 * Checks whether two groups can be merged without combining known
 * co-instructors.
 *
 * @example
 * canUnion('CHAN, Alice', 'CHAN, Bob', set, sameReportPairs)
 * // => false when Alice and Bob appeared together on the same report
 */
function canUnion(
  nameA: string,
  nameB: string,
  disjointSet: DisjointSet<string>,
  sameReportPairs: Set<string>,
): boolean {
  for (const memberA of disjointSet.members(nameA)) {
    for (const memberB of disjointSet.members(nameB)) {
      if (sameReportPairs.has(pairKey(memberA, memberB))) {
        return false
      }
    }
  }
  return true
}

/**
 * Prioritizes data sources for choosing a canonical display spelling.
 *
 * CQ (`x`) names are preferred because they are what the website/course data
 * already uses, followed by review names, then SFQ-only names.
 *
 * @example
 * sourceScore(statsFromCqAndSfq) > sourceScore(statsFromSfqOnly)
 * // => true
 */
function sourceScore(stats: InstructorStats): number {
  let score = 0
  if (stats.criteria.has('x')) score += 100
  if (
    stats.criteria.has('content')
    || stats.criteria.has('teaching')
    || stats.criteria.has('grading')
    || stats.criteria.has('workload')
  ) {
    score += 80
  }
  if (stats.criteria.has('course') || stats.criteria.has('instructor')) {
    score += 20
  }
  return score
}

/**
 * Scores a name spelling for display after a group has been merged.
 *
 * @example
 * displayScore(parseInstructorName('IP, Ivan Chi Ho')!, stats)
 * // => larger than an SFQ-only spelling when stats includes CQ/review criteria
 */
function displayScore(profile: NameProfile, stats: InstructorStats): number {
  let score = sourceScore(stats) * 1_000_000
  score += profile.hasComma ? 100_000 : 0
  score += profile.name.includes(' ,') ? 0 : 10_000
  score += stats.reportCount * 100
  score += Math.min(stats.samples, 99)
  return score
}

/**
 * Sorts canonical candidates from best display spelling to worst.
 *
 * @example
 * [sfqProfile, cqProfile].sort((a, b) => compareCanonical(a, b, stats))[0]
 * // => cqProfile when the CQ spelling is available
 */
function compareCanonical(
  profileA: NameProfile,
  profileB: NameProfile,
  stats: Map<string, InstructorStats>,
): number {
  const scoreA = displayScore(profileA, stats.get(profileA.name)!)
  const scoreB = displayScore(profileB, stats.get(profileB.name)!)
  if (scoreA !== scoreB) return scoreB - scoreA

  return profileA.name.localeCompare(profileB.name)
}

/**
 * Builds a map from every observed spelling to the canonical spelling.
 *
 * @example
 * buildInstructorMapping(reports).get('IP, Chi Ho Ivan')
 * // => 'IP, Ivan Chi Ho'
 */
function buildInstructorMapping(reports: Report[]): Map<string, string> {
  const { stats, sameReportPairs } = buildInstructorStats(reports)
  const profiles = new Map(
    Array.from(stats.keys())
      .map(name => [name, parseInstructorName(name)] as const)
      .filter((entry): entry is readonly [string, NameProfile] => entry[1] !== undefined),
  )
  const disjointSet = new DisjointSet<string>(stats.keys())
  const profilesByFamily = Map.groupBy(profiles.values(), profile => profile.family)
  const edges: { nameA: string, nameB: string, score: number }[] = []

  for (const familyProfiles of profilesByFamily.values()) {
    for (let i = 0; i < familyProfiles.length; i++) {
      for (let j = i + 1; j < familyProfiles.length; j++) {
        const profileA = familyProfiles[i]!
        const profileB = familyProfiles[j]!
        if (sameReportPairs.has(pairKey(profileA.name, profileB.name))) continue

        const score = linkScore(
          profileA,
          profileB,
          stats.get(profileA.name)!,
          stats.get(profileB.name)!,
        )
        if (score !== undefined) {
          edges.push({ nameA: profileA.name, nameB: profileB.name, score })
        }
      }
    }
  }

  edges.sort((edgeA, edgeB) => edgeB.score - edgeA.score)
  for (const edge of edges) {
    if (canUnion(edge.nameA, edge.nameB, disjointSet, sameReportPairs)) {
      disjointSet.union(edge.nameA, edge.nameB)
    }
  }

  const instructorMapping = new Map<string, string>()
  for (const group of disjointSet.groups()) {
    const canonical = Array.from(group)
      .sort((nameA, nameB) => {
        const profileA = profiles.get(nameA)
        const profileB = profiles.get(nameB)
        if (!profileA || !profileB) {
          return nameA.localeCompare(nameB)
        }
        return compareCanonical(profileA, profileB, stats)
      })[0]!

    for (const instructor of group) {
      instructorMapping.set(instructor, canonical)
    }
  }

  return instructorMapping
}

/**
 * Mutates reports so every instructor list contains normalized canonical names.
 *
 * @example
 * normalizeInstructors(reports)
 * reports.some(report => report.instructors.includes('IP, Chi Ho Ivan'))
 * // => false after that spelling is mapped to 'IP, Ivan Chi Ho'
 */
export function normalizeInstructors(reports: Report[]): void {
  const instructorMapping = buildInstructorMapping(reports)

  for (const report of reports) {
    report.instructors = Array.from(new Set(
      report.instructors
        .flatMap(normalizeInstructorName)
        .map((instructor) => {
          console.assert(instructorMapping.has(instructor), 'Instructor not found in mapping:', instructor)
          return instructorMapping.get(instructor) ?? instructor
        }),
    ))
  }
}
