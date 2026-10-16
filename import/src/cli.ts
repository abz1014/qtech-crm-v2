import { createClient } from '@supabase/supabase-js'
import { join } from 'node:path'
import { pktDate } from './lib/dates'
import { assertTargetAllowed, GuardError } from './load/guard'
import { LoadError, loadLegacy } from './load/loader'
import { loadMappings } from './mappings'
import { readDump } from './extract/dump'
import { LiveExtractor } from './extract/live'
import { reconciles, renderReport, writeReport } from './report/report'
import { transformAll } from './transform'

// Usage (see docs/IMPORT.md):
//   npm run import:report -- --dump <file|folder> --mappings <folder> [--out <folder>] [--as-of YYYY-MM-DD]
//   IMPORT_TARGET_URL=... IMPORT_SERVICE_ROLE_KEY=... npm run import:load -- --dump ... --mappings ... [--i-know-this-is-live --allow-project-ref <ref>]
//
// The target URL and key come from the environment only (never an argument, never a file in the repo). This program reads no .env file.

interface Args {
  command: string
  dump?: string
  mappings?: string
  out?: string
  asOf?: string
  iKnowThisIsLive: boolean
  allowProjectRefs: string[]
  allowUnreconciled: boolean
}

function parseArgs(argv: string[]): Args {
  const a: Args = { command: argv[0] ?? '', iKnowThisIsLive: false, allowProjectRefs: [], allowUnreconciled: false }
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${k} needs a value`)
      return v
    }
    if (k === '--dump') a.dump = next()
    else if (k === '--mappings') a.mappings = next()
    else if (k === '--out') a.out = next()
    else if (k === '--as-of') a.asOf = next()
    else if (k === '--i-know-this-is-live') a.iKnowThisIsLive = true
    else if (k === '--allow-project-ref') a.allowProjectRefs.push(next())
    else if (k === '--allow-unreconciled') a.allowUnreconciled = true
    else throw new Error(`Unknown option ${k}`)
  }
  return a
}

function need<T>(v: T | undefined, name: string): T {
  if (v === undefined) throw new Error(`${name} is required`)
  return v
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const out = args.out ?? join('import', '.data', 'out')
  const asOf = args.asOf ?? pktDate(new Date())

  if (args.command === 'extract-live') {
    await new LiveExtractor({ iKnowThisIsLive: args.iKnowThisIsLive, sourceUrl: '' }).extract()
    return 0
  }
  if (args.command !== 'report' && args.command !== 'load') {
    console.error('Usage: cli.ts report|load --dump <file|folder> --mappings <folder> [--out <folder>] [--as-of YYYY-MM-DD]')
    return 2
  }

  const parsed = readDump(need(args.dump, '--dump'))
  parsed.warnings.forEach(w => console.warn(`warning: ${w}`))
  const maps = loadMappings(need(args.mappings, '--mappings'))

  if (args.command === 'report') {
    // Offline: no database, no keys. People get placeholder ids.
    const result = transformAll(parsed.dump, maps, { asOf, v2Users: null })
    const files = writeReport(out, result)
    console.log(renderReport(result))
    console.log(`Wrote ${files.length} files to ${out}`)
    return reconciles(result.recon) ? 0 : 1
  }

  // load
  const url = process.env['IMPORT_TARGET_URL'] ?? ''
  const key = process.env['IMPORT_SERVICE_ROLE_KEY'] ?? ''
  const target = assertTargetAllowed(url, key, { iKnowThisIsLive: args.iKnowThisIsLive, allowProjectRefs: args.allowProjectRefs })
  console.log(`Target: ${target.kind === 'local' ? 'local stack' : `LIVE project ${target.ref}`} (${target.host})`)

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: users, error } = await db.from('users').select('id,name')
  if (error) throw new LoadError(`read users: ${error.message}`)
  const result = transformAll(parsed.dump, maps, { asOf, v2Users: (users ?? []) as { id: string; name: string }[] })
  const files = writeReport(out, result)
  console.log(`Report written to ${out} (${files.length} files)`)
  if (!reconciles(result.recon) && !args.allowUnreconciled) {
    console.error('REFUSED: the money does not reconcile (old != new + left out). See report.md. Nothing was written to the database.')
    return 1
  }

  const summary = await loadLegacy({ db, result, storageDir: parsed.storageDir, log: line => console.log(line) })
  writeReport(out, { ...result, review: [...result.review, ...summary.review] })
  console.log(JSON.stringify({ deleted: summary.deleted, inserted: summary.inserted, reused: summary.reused, auditRowsRemoved: summary.auditRowsRemoved, storage: summary.storage }, null, 2))
  if (summary.mismatches.length) {
    console.error(`READ-BACK MISMATCH:\n  - ${summary.mismatches.join('\n  - ')}`)
    return 1
  }
  console.log('Read-back check passed.')
  return 0
}

main().then(
  code => process.exit(code),
  (e: unknown) => {
    if (e instanceof GuardError || e instanceof LoadError) console.error(e.message)
    else console.error(e)
    process.exit(1)
  },
)
