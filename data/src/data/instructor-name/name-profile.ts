export interface NameProfile {
  name: string
  family: string
  givenTokens: string[]
  sortedGivenKey: string
  hasComma: boolean
}

/**
 * Converts a raw instructor string into the display-form candidates used by
 * the matcher.
 *
 * The return type is an array because some source strings should produce no
 * instructor at all, such as teaching-team placeholders.
 *
 * @example
 * normalizeInstructorName(' IP,   Chi Ho Ivan ')
 * // => ['IP, Chi Ho Ivan']
 *
 * @example
 * normalizeInstructorName('Teaching Team')
 * // => []
 */
export function normalizeInstructorName(instructor: string): string[] {
  const normalized = instructor
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .trim()

  if (normalized.toLowerCase().includes('teaching team')) {
    return []
  }
  if (/\d/.exec(normalized)) {
    return []
  }

  const parts = normalized
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0)

  if (parts.length >= 2) {
    return [`${parts[0]}, ${parts.slice(1, 2).join(' ')}`]
  }
  return normalized ? [normalized] : []
}

/**
 * Converts text into a comparable, ASCII-ish lower-case form.
 *
 * @example
 * normalizedText('WONG, Kai-Sun Albert')
 * // => 'wong, kai sun albert'
 *
 * @example
 * normalizedText('José')
 * // => 'jose'
 */
export function normalizedText(text: string): string {
  return text
    // NFKD decomposes accented letters, e.g. "é" becomes "e" + accent mark.
    .normalize('NFKD')
    // Drop the combining accent marks exposed by NFKD.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’]/g, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[-_/]/g, ' ')
    .replace(/[^A-Za-z, ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Splits a name fragment into normalized word tokens.
 *
 * @example
 * tokens('Kai-Sun Albert')
 * // => ['kai', 'sun', 'albert']
 */
export function tokens(text: string): string[] {
  return normalizedText(text)
    .replace(/,/g, ' ')
    .split(' ')
    .filter(part => part.length > 0)
}

/**
 * Returns whether a word is a likely all-caps family-name marker.
 *
 * @example
 * isUppercaseWord('IP')
 * // => true
 *
 * @example
 * isUppercaseWord('Ivan')
 * // => false
 */
function isUppercaseWord(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, '')
  return letters.length > 1 && letters === letters.toUpperCase()
}

/**
 * Splits a no-comma name into family and given tokens.
 *
 * It uses all-caps words as the strongest signal for the family name because
 * some SFQ/CQ records use forms such as `ZHELYAZKOV Pavel Ivanov`.
 *
 * @example
 * parseNoCommaName('ZHELYAZKOV Pavel Ivanov')
 * // => [['zhelyazkov'], ['pavel', 'ivanov']]
 *
 * @example
 * parseNoCommaName('QIU Luying Iris')
 * // => [['qiu'], ['luying', 'iris']]
 */
export function parseNoCommaName(name: string): [familyTokens: string[], givenTokens: string[]] {
  const rawWords = name
    .replace(/[()[\]{}]/g, ' ')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length > 0)

  const normalizedWords = rawWords
    .map(word => tokens(word)[0])
    .filter((word): word is string => word !== undefined)

  if (normalizedWords.length <= 1) {
    return [normalizedWords, []]
  }

  if (isUppercaseWord(rawWords[0]!)) {
    let familyTokenCount = 0
    while (
      familyTokenCount < rawWords.length - 1
      && isUppercaseWord(rawWords[familyTokenCount]!)
    ) {
      familyTokenCount++
    }
    return [
      normalizedWords.slice(0, familyTokenCount),
      normalizedWords.slice(familyTokenCount),
    ]
  }

  if (isUppercaseWord(rawWords[rawWords.length - 1]!)) {
    let familyStart = rawWords.length - 1
    while (familyStart > 0 && isUppercaseWord(rawWords[familyStart - 1]!)) {
      familyStart--
    }
    return [
      normalizedWords.slice(familyStart),
      normalizedWords.slice(0, familyStart),
    ]
  }

  return [
    normalizedWords.slice(0, 1),
    normalizedWords.slice(1),
  ]
}

/**
 * Parses a normalized instructor display name into the fields used for
 * matching.
 *
 * @example
 * parseInstructorName('IP, Ivan Chi Ho')
 * // => {
 * //   name: 'IP, Ivan Chi Ho',
 * //   family: 'ip',
 * //   givenTokens: ['ivan', 'chi', 'ho'],
 * //   sortedGivenKey: 'chi|ho|ivan',
 * //   hasComma: true,
 * // }
 *
 * @example
 * parseInstructorName('ZHELYAZKOV Pavel Ivanov')?.family
 * // => 'zhelyazkov'
 */
export function parseInstructorName(name: string): NameProfile | undefined {
  const cleanName = name
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .trim()
  const normalized = normalizedText(cleanName)

  let familyTokens: string[]
  let givenTokens: string[]

  if (normalized.includes(',')) {
    const [family = '', ...givenParts] = normalized.split(',')
    familyTokens = tokens(family)
    givenTokens = tokens(givenParts.join(' '))
  }
  else {
    [familyTokens, givenTokens] = parseNoCommaName(cleanName)
  }

  if (familyTokens.length === 0 || givenTokens.length === 0) {
    return undefined
  }

  return {
    name,
    family: familyTokens.join(' '),
    givenTokens,
    sortedGivenKey: [...givenTokens].sort().join('|'),
    hasComma: cleanName.includes(','),
  }
}
