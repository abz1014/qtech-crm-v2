// Bundle budget gate (P04): fails if the initial JS of dist/ exceeds 300 KB gzipped, and reports the lazy PDF chunk and
// the service-worker precache so a regression in either is visible in the CI summary. It also fails if the PDF reader
// (pdf.js, src/lib/docread) lands in the first load or in the precache. Usage: node scripts/bundle-budget.mjs [distDir]
import { appendFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { INITIAL_JS_BUDGET_BYTES, initialJs, kb, largestLazyChunk, pdfjsInInitial, pdfReaderFiles, precacheSize } from './bundle-budget.lib.mjs'

const dist = resolve(process.argv[2] ?? 'dist')
const listing = readdirSync(join(dist, 'assets')).map(f => `assets/${f}`)
const initial = initialJs(dist)
const lazy = largestLazyChunk(dist, initial, listing)
const pre = precacheSize(dist)
const reader = pdfReaderFiles(dist, listing)
const readerRaw = reader.reduce((n, f) => n + f.raw, 0)
const readerGzip = reader.reduce((n, f) => n + f.gzip, 0)

const lines = [
  '### Bundle budget (P04)',
  '',
  '| Measure | Raw | Gzip | Limit |',
  '|---|---|---|---|',
  `| Initial JS (${initial.files.size} file${initial.files.size === 1 ? '' : 's'}) | ${kb(initial.total.raw)} | ${kb(initial.total.gzip)} | ${kb(INITIAL_JS_BUDGET_BYTES)} gzip |`,
  `| Largest lazy chunk (PDF renderer): ${lazy?.file ?? 'none'} | ${lazy ? kb(lazy.raw) : '-'} | ${lazy ? kb(lazy.gzip) : '-'} | not on first load, not precached |`,
  reader.length
    ? `| PDF reader (pdf.js, lazy): ${reader.map(f => f.file).join(' + ')} | ${kb(readerRaw)} | ${kb(readerGzip)} | not on first load, not precached |`
    : '| PDF reader (pdf.js, lazy) | - | - | not in the build: no screen reads PDFs yet |',
  `| Service worker precache (${pre.entries} entries) | ${kb(pre.raw)} | ${kb(pre.gzip)} | shell only |`,
  `| sw.js itself | ${kb(pre.swRaw)} | ${kb(pre.swGzip)} | |`,
]
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)

if (initial.total.gzip > INITIAL_JS_BUDGET_BYTES) {
  console.error(`\nFAIL: initial JS is ${kb(initial.total.gzip)} gzipped, over the ${kb(INITIAL_JS_BUDGET_BYTES)} budget.`)
  process.exit(1)
}
// The PDF renderer must stay out of the precache (R21): it is fetched on demand, not stored on every phone.
if (lazy && pre.urls.includes(lazy.file)) {
  console.error(`\nFAIL: the lazy PDF chunk ${lazy.file} is in the service worker precache.`)
  process.exit(1)
}
// The PDF reader is loaded only when a PDF is read (owner decision 2026-10-20): never in the first load, never precached.
const eager = pdfjsInInitial(dist, initial)
if (eager.length) {
  console.error(`\nFAIL: pdf.js is in the first load (${eager.join(', ')}). Import it only through src/lib/docread/pdfText.ts.`)
  process.exit(1)
}
const cached = reader.filter(f => pre.urls.includes(f.file))
if (cached.length) {
  console.error(`\nFAIL: the PDF reader ${cached.map(f => f.file).join(', ')} is in the service worker precache.`)
  process.exit(1)
}
console.log('\nOK: within budget.')
