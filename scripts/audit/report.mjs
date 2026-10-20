#!/usr/bin/env node
/*
 * Screen audit report (docs/audit/SCREEN_AUDIT.md). Reads <dir>/parts/*.json (written by e2e/audit/screens.audit.ts), writes
 * <dir>/audit-results.json, <dir>/audit-report.md and <dir>/audit-summary.md (targets and worst lists only).
 *
 *   node scripts/audit/report.mjs [dir=test-results/screen-audit] [--ref main] [--sha 0123abc]
 *
 * --ref and --sha fill in what was audited when the parts do not say (a local run).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildResults, renderMarkdown, renderSummary } from './report.lib.mjs'

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const ref = flag('ref')
const sha = flag('sha')
const dir = args[0] ?? 'test-results/screen-audit'

const partsDir = join(dir, 'parts')
let files = []
try {
  files = readdirSync(partsDir).filter(f => f.endsWith('.json'))
} catch {
  // no parts directory: reported below
}
if (!files.length) {
  console.error(`No result parts in ${partsDir}. Run the audit first (docs/audit/SCREEN_AUDIT.md).`)
  process.exit(1)
}
const parts = files.map(f => JSON.parse(readFileSync(join(partsDir, f), 'utf8')))
const results = buildResults(parts)
if (ref && !results.meta.ref) results.meta.ref = ref
if (sha && !results.meta.sha) results.meta.sha = sha

writeFileSync(join(dir, 'audit-results.json'), JSON.stringify(results, null, 1))
writeFileSync(join(dir, 'audit-report.md'), renderMarkdown(results))
writeFileSync(join(dir, 'audit-summary.md'), renderSummary(results))

const s = results.summary
console.log(`${s.captures} captures from ${files.length} part(s): ${Object.entries(s.status).map(([k, v]) => `${k} ${v}`).join(', ')}`)
for (const t of results.targets) {
  const r = s.byTarget[t.key]
  console.log(`  ${t.label.padEnd(44)} ${String(r.passed).padStart(4)} / ${String(r.applicable).padEnd(4)} meet "${t.target}"`)
}
console.log(`Wrote ${join(dir, 'audit-results.json')}, audit-report.md and audit-summary.md`)
