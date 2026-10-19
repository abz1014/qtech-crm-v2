import { describe, expect, it } from 'vitest'
import { parseMappings } from '../src/mappings'
import { runChecklist } from '../src/i06/checklist'
import { renderReport } from '../src/report/report'
import { transformAll } from '../src/transform'
import type { LegacyDump } from '../src/types'
import { AS_OF, fixtureDump, V2_USERS, violations } from './support'

// Performance smoke test: a dump 50 times the fixture's size must go through the whole transform (and the report and the
// I06 checklist) in under two minutes. It takes a few seconds; the budget is there to catch an accidental O(n^2).
const COPIES = 50
const BUDGET_MS = 120_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_COLUMNS = new Set(['company_name', 'client_name', 'gst_invoice_number', 'invoice_number'])

/** The fixture repeated `copies` times: ids re-keyed per copy (people shared), customer, vendor and invoice names made distinct. */
export function scaleDump(base: LegacyDump, copies: number): LegacyDump {
  const userIds = new Set((base.tables['users'] ?? []).map(u => String(u['id'])))
  const tables: LegacyDump['tables'] = {}
  for (const [table, rows] of Object.entries(base.tables)) {
    if (table === 'users') {
      tables[table] = rows
      continue
    }
    tables[table] = []
    for (let k = 0; k < copies; k++) {
      const tag = k.toString(16).padStart(2, '0')
      for (const row of rows ?? []) {
        const out: Record<string, unknown> = {}
        for (const [col, v] of Object.entries(row)) {
          if (typeof v === 'string' && UUID.test(v) && !userIds.has(v)) out[col] = `${v.slice(0, 2)}${tag}${v.slice(4)}`
          else if (typeof v === 'string' && v !== '' && (NAME_COLUMNS.has(col) || (table === 'vendors' && col === 'name'))) out[col] = `${v} ${k}`
          else out[col] = v
        }
        tables[table]!.push(out)
      }
    }
  }
  return { tables, storage: base.storage, meta: base.meta }
}

describe('performance smoke test', () => {
  it(`transforms a dump ${COPIES} times the fixture in under two minutes, and the output is still valid`, () => {
    const big = scaleDump(fixtureDump(), COPIES)
    const rows = Object.values(big.tables).reduce((s, r) => s + (r?.length ?? 0), 0)
    expect(rows).toBeGreaterThan(COPIES * 140)

    const t0 = performance.now()
    const result = transformAll(big, parseMappings({}), { asOf: AS_OF, v2Users: V2_USERS })
    const report = renderReport(result)
    const checklist = runChecklist(big)
    const ms = performance.now() - t0
    console.log(`perf smoke: ${rows} source rows, ${Object.values(result.tables).reduce((s, r) => s + r.length, 0)} new rows, ${Math.round(ms)} ms`)

    expect(ms).toBeLessThan(BUDGET_MS)
    expect(report).toContain('Reconciles: **yes**')
    expect(checklist).toHaveLength(25)
    // still one merged PO 000001 order per copy (22 old orders -> 21 per copy), nothing lost, no database rule broken
    expect(result.tables.orders).toHaveLength(21 * COPIES)
    expect(result.recon.payments.diff).toBe(0)
    expect(violations(result)).toEqual([])
  })
})
