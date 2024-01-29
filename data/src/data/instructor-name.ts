import type { Report } from './report.ts'
import { memoize } from 'es-toolkit'

function normalize(instructor: string): string[] {
  if (instructor.toLowerCase().includes('teaching team')) {
    return []
  }
  if (/\d/.exec(instructor)) {
    return []
  }
  return [
    instructor.split(',')
      .map(part => part.trim())
      .slice(0, 2)
      .join(', '),
  ]
}

const parseName = memoize((name: string) => {
  const parts = name
    .split(/\W+/)
    .filter(part => part.length > 0)
    .map(part => part.toLowerCase())
  const matcher = parts
    .filter(part => part.length > 0)
    .map((part) => {
      // If the part is a single character, it is likely an initial.
      if (part.length === 1 && part === part.toUpperCase()) {
        return `(${part}\\w*)`
      }
      // Otherwise, it is likely a full name.
      return `((${part[0]!.toUpperCase()})|${part})`
    })
    .join('\\W+')
  return [
    parts,
    new RegExp(`^${matcher}$`, 'i'),
  ] as const
})

function areInstructorsLikelyEqual(
  nameA: string,
  nameB: string,
): boolean {
  if (nameA === nameB) {
    return true
  }

  const [partsA, matcherA] = parseName(nameA)
  const [partsB, matcherB] = parseName(nameB)

  const partsAString = `|${partsA.join('|')}|`
  const partsBString = `|${partsB.join('|')}|`
  if (partsAString.startsWith(partsBString) || partsBString.startsWith(partsAString)) {
    return true
  }
  return matcherA.test(nameB) || matcherB.test(nameA)
}

function areInstructorsMutuallyEqual(
  instructors: string[],
): boolean {
  for (let i = 0; i < instructors.length; i++) {
    for (let j = i + 1; j < instructors.length; j++) {
      if (!areInstructorsLikelyEqual(instructors[i]!, instructors[j]!)) {
        return false
      }
    }
  }
  return true
}

function compareInstructors(
  instructorA: string,
  instructorB: string,
): number {
  console.assert(
    areInstructorsLikelyEqual(instructorA, instructorB),
    `Instructors are not likely equal: ${instructorA} :: ${instructorB}`,
  )

  const partsA = instructorA.split(/\W+/)
  const partsB = instructorB.split(/\W+/)

  // Prefer initials over full names
  if (partsA.some(it => it.length === 1 && it === it.toUpperCase())) {
    return -1
  }
  if (partsB.some(it => it.length === 1 && it === it.toUpperCase())) {
    return +1
  }

  // Prefer the one with hyphens
  if (instructorA.includes('-') && !instructorB.includes('-')) {
    return -1
  }
  if (instructorB.includes('-') && !instructorA.includes('-')) {
    return +1
  }

  // Prefer the one with commas
  if (instructorA.includes(',') && !instructorB.includes(',')) {
    return -1
  }
  if (instructorB.includes(',') && !instructorA.includes(',')) {
    return +1
  }

  // Prefer prefixes
  if (instructorA.startsWith(instructorB)) {
    return -1
  }
  if (instructorB.startsWith(instructorA)) {
    return +1
  }

  // Prefer the one with more captial letters
  const capitalCountA = (instructorA.match(/[A-Z]/g) ?? []).length
  const capitalCountB = (instructorB.match(/[A-Z]/g) ?? []).length
  if (capitalCountA > capitalCountB) {
    return -1
  }
  if (capitalCountB > capitalCountA) {
    return +1
  }

  console.assert(false, `Cannot determine order for ${instructorA} :: ${instructorB}`)
  return 0
}

export function normalizeInstructors(reports: Report[]) {
  const allInstructors = new Set(reports.flatMap(report => report.instructors.flatMap(normalize)))
  const instructorMapping = new Map<string, string>()
  const instructorSet = new Set<string>()

  for (const instructor of allInstructors) {
    if (instructorSet.has(instructor)) continue
    const sameInstructors = allInstructors.values()
      .filter(i => areInstructorsLikelyEqual(i, instructor))
      .toArray()
    // console.assert(
    //   sameInstructors.length <= 2,
    //   `Found more than two instructors that are likely equal: ${sameInstructors.join(', ')}`,
    // )
    if (areInstructorsMutuallyEqual(sameInstructors)) {
      sameInstructors.sort(compareInstructors)
      const bestInstructor = sameInstructors[0]!
      for (const sameInstructor of sameInstructors) {
        allInstructors.delete(sameInstructor)
        instructorMapping.set(sameInstructor, bestInstructor)
      }
    }
    else {
      allInstructors.delete(instructor)
      instructorMapping.set(instructor, instructor)
    }
  }

  for (const report of reports) {
    report.instructors = report.instructors
      .flatMap(normalize)
      .map((instructor) => {
        console.assert(instructorMapping.has(instructor), 'Instructor not found in mapping:', instructor)
        return instructorMapping.get(instructor) ?? instructor
      })
  }
}
