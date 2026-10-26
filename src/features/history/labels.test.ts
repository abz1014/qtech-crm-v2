import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HISTORY_TABLES } from '@/features/history/api'
import { ALWAYS_HIDDEN, HISTORY_CHILD_TABLES, LABELS, TABLES_WITH_LABELS, columnSpec } from '@/features/history/labels'

/*
 * The column lists come from src/types/database.ts itself (the generated Row types), read at test time, so a column added by a
 * later migration fails here until it is labelled or explicitly hidden.
 */
const source = readFileSync(resolve(process.cwd(), 'src/types/database.ts'), 'utf8')
const publicAt = source.indexOf('"public": {')

function rowColumns(table: string): string[] {
  const at = source.indexOf(`"${table}": {`, publicAt)
  expect(at, `table ${table} is in database.ts`).toBeGreaterThan(-1)
  const row = source.indexOf('Row: {', at)
  const end = source.indexOf('}', row)
  return [...source.slice(row + 6, end).matchAll(/"(\w+)"\??:/g)].map(m => m[1])
}

describe('history labels', () => {
  it('covers the record kinds and the child tables', () => {
    expect([...TABLES_WITH_LABELS].sort()).toEqual([...HISTORY_TABLES, ...HISTORY_CHILD_TABLES].sort())
  })

  for (const table of [...HISTORY_TABLES, ...HISTORY_CHILD_TABLES]) {
    it(`${table}: every column has a label or an explicit hide`, () => {
      const cols = rowColumns(table)
      expect(cols.length).toBeGreaterThan(0)
      const missing = cols.filter(c => columnSpec(table, c) === undefined)
      expect(missing, `unlabelled columns of ${table}`).toEqual([])
    })

    it(`${table}: no label names a column that does not exist`, () => {
      const cols = new Set(rowColumns(table))
      const stale = Object.keys(LABELS[table] ?? {}).filter(c => !cols.has(c))
      expect(stale, `labels for columns ${table} no longer has`).toEqual([])
    })
  }

  it('hides ids, stamps, model tokens and legacy columns everywhere', () => {
    for (const c of ALWAYS_HIDDEN) expect(columnSpec('expenses', c)?.kind).toBe('hide')
  })

  it('names bank_month "Ticked in bank"', () => {
    expect(columnSpec('expenses', 'bank_month')).toMatchObject({ label: 'Ticked in bank', kind: 'date' })
    expect(columnSpec('payments_in', 'bank_month')?.label).toBe('Ticked in bank')
  })

  it('shows money columns as money', () => {
    expect(columnSpec('expenses', 'amount_pkr')).toMatchObject({ label: 'Amount', kind: 'money' })
    expect(columnSpec('invoices', 'net_amount')?.kind).toBe('money')
  })
})
