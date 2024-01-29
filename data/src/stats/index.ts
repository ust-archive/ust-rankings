import { calcBayesian } from './ratings.ts'

export async function main() {
  const { measure } = await import('../data/utils.ts')
  const course = await import('./course')
  const instructor = await import('./instructor')

  await measure(async (timer) => {
    const ratings = course.calc()
    calcBayesian(ratings.map(it => it.ratings))
    await Bun.file('ratings-course.json').write(JSON.stringify(ratings, null, 2))
    console.log(`Calculated course ratings in ${timer()} ms`)
  })
  await measure(async (timer) => {
    const ratings = instructor.calc()
    calcBayesian(ratings.map(it => it.ratings))
    await Bun.file('ratings-instructor.json').write(JSON.stringify(ratings, null, 2))
    console.log(`Calculated instructor ratings in ${timer()} ms`)
  })
}

import esMain from 'es-main'

if (esMain(import.meta)) {
  await main()
}
