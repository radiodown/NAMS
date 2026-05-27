import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createServer } from 'vite'

function usage() {
  console.log('Usage: npm run banksalad:migrate -- <input.xlsx> [output.json]')
}

function outputPathFor(inputPath) {
  return inputPath.replace(/\.xlsx$/i, '') + '.nams.json'
}

const [, , inputArg, outputArg] = process.argv
if (!inputArg || inputArg === '-h' || inputArg === '--help') {
  usage()
  process.exit(inputArg ? 0 : 1)
}

const inputPath = resolve(inputArg)
const outputPath = resolve(outputArg || outputPathFor(inputPath))
const buffer = await readFile(inputPath)
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
})

let migration
try {
  const { migrateBanksaladWorkbook } = await vite.ssrLoadModule('/src/lib/banksaladMigration.js')
  migration = migrateBanksaladWorkbook(buffer)
} finally {
  await vite.close()
}

const { document, summary } = migration

await writeFile(outputPath, JSON.stringify(document, null, 2) + '\n', 'utf8')

console.log(
  [
    `Created ${basename(outputPath)}`,
    `sheet=${summary.sheetName}`,
    `income=${summary.incomeCount}`,
    `expense=${summary.expenseCount}`,
    `assets=${summary.assetCount}`,
    `assetValue=${Math.round(summary.assetValueTotal).toLocaleString('ko-KR')}`,
    `skipped=${summary.skippedCount}`,
    `paymentMethods=${summary.paymentMethodCount}`,
  ].join(' ')
)
