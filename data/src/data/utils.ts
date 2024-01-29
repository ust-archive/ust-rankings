export function termName2Code(name: string): string {
  const [yearString, seasonString] = name.split(' ')
  const year = yearString!.slice(2, 4)
  const season = {
    Fall: '10',
    Winter: '20',
    Spring: '30',
    Summer: '40',
  }[seasonString!]
  return year + season
}

export function termCode2Num(term: string): number {
  return parseInt(term.slice(0, 2)) * 4 + (parseInt(term.slice(2, 3)) - 1)
}

export async function measure<T>(fn: (timer: () => number) => Promise<T>): Promise<T> {
  const time = Date.now()
  const timer = () => Date.now() - time
  return await fn(timer)
}
