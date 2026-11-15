#!/usr/bin/env node
// Folds the Forest audit's per-worker lines (e2e/audit-forest, <dir>/findings/*.jsonl) into <dir>/findings.json and <dir>/summary.json.
// Several directories (one per downloaded CI shard) can be given: the output then goes to the first one... or to --out <dir>.
//   node scripts/audit/forest-merge.mjs test-results/forest-audit
//   node scripts/audit/forest-merge.mjs --out merged shard1/test-results/forest-audit shard2/test-results/forest-audit
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
let out = null
const dirs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i]
  else dirs.push(args[i])
}
if (!dirs.length) {
  console.error('usage: forest-merge.mjs [--out dir] <audit dir>...')
  process.exit(2)
}
out ??= dirs[0]
mkdirSync(out, { recursive: true })

const lines = (dir, prefix) => {
  const d = join(dir, 'findings')
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter(f => f.startsWith(prefix) && f.endsWith('.jsonl'))
    .flatMap(f =>
      readFileSync(join(d, f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => {
          try {
            return JSON.parse(l)
          } catch {
            return null
          }
        })
        .filter(Boolean),
    )
}
const findings = dirs.flatMap(d => lines(d, 'findings-'))
const combos = dirs.flatMap(d => lines(d, 'combos-'))
const count = (xs, key) => Object.fromEntries(Object.entries(xs.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]))
const summary = {
  combinations: combos.length,
  findings: findings.length,
  byRule: count(findings, f => f.rule),
  byRoute: count(findings, f => f.route),
  byRuleRoute: count(findings, f => `${f.rule} | ${f.route}`),
  combosByState: count(combos, c => String(c.state).replace(/^dialog-.*/, 'dialog')),
  combosByRole: count(combos, c => c.role),
}
writeFileSync(join(out, 'findings.json'), JSON.stringify(findings, null, 1))
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`forest audit: ${combos.length} views checked, ${findings.length} findings -> ${join(out, 'findings.json')}`)
for (const [rule, n] of Object.entries(summary.byRule).slice(0, 40)) console.log(`  ${String(n).padStart(6)}  ${rule}`)
