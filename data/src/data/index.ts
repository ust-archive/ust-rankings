import * as cq from './cq'
import esMain from 'es-main'
import * as sfq from './sfq'
import * as review from './review'
import { measure } from './utils.ts'
import { type Report, standardize } from './report.ts'
import { normalizeInstructors } from './instructor-name.ts'

export const reports: Report[] = []

await measure(async (timer) => {
  const rawReports: Report[] = []
  rawReports.push(...(await cq.load()))
  rawReports.push(...(await review.load()))
  rawReports.push(...(await sfq.load()))
  reports.push(...standardize(rawReports))
  normalizeInstructors(reports)
  console.log(`Load data in ${timer()} ms`)
})

if (esMain(import.meta)) {
  await Bun.file('reports.json').write(
    JSON.stringify(reports, null, 2),
  )
}
